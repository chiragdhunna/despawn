/**
 * Session state machine (see docs/STATE_MACHINE.md).
 *
 * `reduce(model, event)` is a pure function: it never mutates its input, performs no I/O and
 * reads no clock. It returns the next model and an ordered list of declarative effects that the
 * relay executes. Timers are modelled as effects (START_TIMER / CANCEL_TIMER) and events (TIMER).
 */
import { MAX_PENDING_REQUESTS, RELEASE_TIMEOUT_MS, UPLOAD_TIMEOUT_MS } from './constants.js';
import { isTerminalState } from './enums.js';
import type {
  ErrorCode,
  SessionState,
  ShopWipeReason,
  TerminalReason,
  TerminalState,
} from './enums.js';
import type { Rules } from './types.js';

export type TimerName = 'upload' | 'link' | 'release' | 'live' | 'grace';

export interface SessionModel {
  readonly state: SessionState;
  readonly rules: Rules;
  /** Request ids awaiting the owner's decision. Non-empty only in AWAITING. */
  readonly pending: readonly string[];
  /** Set when the owner approves. Retained in terminal states for audit. */
  readonly approvedReqId: string | null;
  readonly printsDone: number;
  readonly printing: boolean;
  readonly shopReportedWipe: boolean;
  readonly terminalReason: TerminalReason | null;
}

export type MachineEvent =
  | { readonly type: 'UPLOADED' }
  | { readonly type: 'SHOP_HELLO'; readonly reqId: string }
  | { readonly type: 'SHOP_REQUEST_DROPPED'; readonly reqId: string }
  | { readonly type: 'OWNER_APPROVE'; readonly reqId: string }
  | { readonly type: 'OWNER_DENY'; readonly reqId: string }
  | { readonly type: 'OWNER_KILL' }
  | { readonly type: 'OWNER_LOST' }
  | { readonly type: 'SHOP_RENDERED' }
  | { readonly type: 'SHOP_PRINT_STARTED' }
  | { readonly type: 'SHOP_PRINTED' }
  | { readonly type: 'SHOP_WIPED'; readonly reason: ShopWipeReason }
  | { readonly type: 'SHOP_LOST' }
  | { readonly type: 'TIMER'; readonly name: TimerName };

export type Effect =
  | { readonly type: 'START_TIMER'; readonly name: TimerName; readonly ms: number }
  | { readonly type: 'CANCEL_TIMER'; readonly name: TimerName }
  | { readonly type: 'CANCEL_ALL_TIMERS' }
  | { readonly type: 'SEND_OWNER_REQUEST'; readonly reqId: string }
  | { readonly type: 'SEND_OWNER_REQUEST_GONE'; readonly reqId: string }
  | { readonly type: 'SEND_OWNER_STATUS' }
  | { readonly type: 'SEND_OWNER_DESTROYED'; readonly reason: TerminalReason }
  | { readonly type: 'SEND_SHOP_DENIED'; readonly reqId: string }
  | { readonly type: 'SEND_SHOP_REJECT'; readonly reqId: string; readonly code: ErrorCode }
  | { readonly type: 'SEND_SHOP_KILL'; readonly reqId: string; readonly reason: TerminalReason }
  | { readonly type: 'RELEASE_TO_SHOP'; readonly reqId: string }
  | { readonly type: 'DELETE_BLOB' }
  | { readonly type: 'REVOKE_BLOB_TOKENS' }
  | {
      readonly type: 'DROP_MESSAGE';
      readonly from: 'owner' | 'shop';
      readonly reason: 'WRONG_STATE' | 'UNKNOWN_REQUEST' | 'LIMIT';
    }
  | {
      readonly type: 'WRITE_TOMBSTONE';
      readonly state: TerminalState;
      readonly reason: TerminalReason;
    }
  | { readonly type: 'SHOP_WIPE_CONFIRMED' };

export interface Transition {
  readonly model: SessionModel;
  readonly effects: readonly Effect[];
}

/** Creates a session in CREATED. The caller must execute the returned effects. */
export function createSession(rules: Rules): Transition {
  return {
    model: {
      state: 'CREATED',
      rules,
      pending: [],
      approvedReqId: null,
      printsDone: 0,
      printing: false,
      shopReportedWipe: false,
      terminalReason: null,
    },
    effects: [{ type: 'START_TIMER', name: 'upload', ms: UPLOAD_TIMEOUT_MS }],
  };
}

const NONE: readonly Effect[] = Object.freeze([]);

function stay(model: SessionModel, effects: readonly Effect[] = NONE): Transition {
  return { model, effects };
}

function drop(
  model: SessionModel,
  from: 'owner' | 'shop',
  reason: 'WRONG_STATE' | 'UNKNOWN_REQUEST' | 'LIMIT',
): Transition {
  return stay(model, [{ type: 'DROP_MESSAGE', from, reason }]);
}

function terminate(
  m: SessionModel,
  state: TerminalState,
  reason: TerminalReason,
  shopWiped = false,
): Transition {
  const shops: string[] = [];
  if (m.approvedReqId !== null) {
    shops.push(m.approvedReqId);
  }
  for (const r of m.pending) {
    if (!shops.includes(r)) {
      shops.push(r);
    }
  }
  const effects: Effect[] = [
    { type: 'CANCEL_ALL_TIMERS' },
    { type: 'DELETE_BLOB' },
    { type: 'REVOKE_BLOB_TOKENS' },
  ];
  for (const reqId of shops) {
    effects.push({ type: 'SEND_SHOP_KILL', reqId, reason });
  }
  effects.push({ type: 'SEND_OWNER_DESTROYED', reason });
  effects.push({ type: 'WRITE_TOMBSTONE', state, reason });
  return {
    model: {
      ...m,
      state,
      pending: [],
      printing: false,
      terminalReason: reason,
      shopReportedWipe: m.shopReportedWipe || shopWiped,
    },
    effects,
  };
}

function onTerminal(m: SessionModel, e: MachineEvent): Transition {
  if (e.type === 'SHOP_HELLO') {
    return stay(m, [{ type: 'SEND_SHOP_REJECT', reqId: e.reqId, code: 'NOT_FOUND' }]);
  }
  if (e.type === 'SHOP_WIPED' && !m.shopReportedWipe) {
    return stay({ ...m, shopReportedWipe: true }, [{ type: 'SHOP_WIPE_CONFIRMED' }]);
  }
  return stay(m);
}

function ownerOrShopWrongState(e: MachineEvent, m: SessionModel): Transition {
  switch (e.type) {
    case 'UPLOADED':
    case 'OWNER_APPROVE':
    case 'OWNER_DENY':
      return drop(m, 'owner', 'WRONG_STATE');
    case 'SHOP_RENDERED':
    case 'SHOP_PRINT_STARTED':
    case 'SHOP_PRINTED':
    case 'SHOP_WIPED':
      return drop(m, 'shop', 'WRONG_STATE');
    default:
      return stay(m);
  }
}

function onCreated(m: SessionModel, e: MachineEvent): Transition {
  switch (e.type) {
    case 'UPLOADED':
      return {
        model: { ...m, state: 'ARMED' },
        effects: [
          { type: 'CANCEL_TIMER', name: 'upload' },
          { type: 'START_TIMER', name: 'link', ms: m.rules.linkTtlMs },
          { type: 'SEND_OWNER_STATUS' },
        ],
      };
    case 'SHOP_HELLO':
      return stay(m, [{ type: 'SEND_SHOP_REJECT', reqId: e.reqId, code: 'NOT_FOUND' }]);
    case 'OWNER_KILL':
      return terminate(m, 'CANCELLED', 'CANCELLED');
    case 'TIMER':
      return e.name === 'upload' ? terminate(m, 'EXPIRED', 'LINK_EXPIRED') : stay(m);
    default:
      return ownerOrShopWrongState(e, m);
  }
}

function onArmed(m: SessionModel, e: MachineEvent): Transition {
  switch (e.type) {
    case 'SHOP_HELLO':
      return {
        model: { ...m, state: 'AWAITING', pending: [e.reqId] },
        effects: [{ type: 'SEND_OWNER_REQUEST', reqId: e.reqId }, { type: 'SEND_OWNER_STATUS' }],
      };
    case 'OWNER_KILL':
      return terminate(m, 'CANCELLED', 'CANCELLED');
    case 'TIMER':
      return e.name === 'link' ? terminate(m, 'EXPIRED', 'LINK_EXPIRED') : stay(m);
    default:
      return ownerOrShopWrongState(e, m);
  }
}

function onAwaiting(m: SessionModel, e: MachineEvent): Transition {
  switch (e.type) {
    case 'SHOP_HELLO': {
      if (m.pending.includes(e.reqId)) {
        return drop(m, 'shop', 'WRONG_STATE');
      }
      if (m.pending.length >= MAX_PENDING_REQUESTS) {
        return stay(m, [{ type: 'SEND_SHOP_REJECT', reqId: e.reqId, code: 'TOO_MANY_REQUESTS' }]);
      }
      return {
        model: { ...m, pending: [...m.pending, e.reqId] },
        effects: [{ type: 'SEND_OWNER_REQUEST', reqId: e.reqId }, { type: 'SEND_OWNER_STATUS' }],
      };
    }
    case 'SHOP_REQUEST_DROPPED': {
      if (!m.pending.includes(e.reqId)) {
        return stay(m);
      }
      const pending = m.pending.filter((r) => r !== e.reqId);
      return {
        model: { ...m, state: pending.length === 0 ? 'ARMED' : 'AWAITING', pending },
        effects: [
          { type: 'SEND_OWNER_REQUEST_GONE', reqId: e.reqId },
          { type: 'SEND_OWNER_STATUS' },
        ],
      };
    }
    case 'OWNER_DENY': {
      if (!m.pending.includes(e.reqId)) {
        return drop(m, 'owner', 'UNKNOWN_REQUEST');
      }
      const pending = m.pending.filter((r) => r !== e.reqId);
      return {
        model: { ...m, state: pending.length === 0 ? 'ARMED' : 'AWAITING', pending },
        effects: [{ type: 'SEND_SHOP_DENIED', reqId: e.reqId }, { type: 'SEND_OWNER_STATUS' }],
      };
    }
    case 'OWNER_APPROVE': {
      if (!m.pending.includes(e.reqId)) {
        return drop(m, 'owner', 'UNKNOWN_REQUEST');
      }
      const effects: Effect[] = [{ type: 'CANCEL_TIMER', name: 'link' }];
      for (const r of m.pending) {
        if (r !== e.reqId) {
          effects.push({ type: 'SEND_SHOP_DENIED', reqId: r });
        }
      }
      effects.push({ type: 'RELEASE_TO_SHOP', reqId: e.reqId });
      effects.push({ type: 'START_TIMER', name: 'release', ms: RELEASE_TIMEOUT_MS });
      effects.push({ type: 'SEND_OWNER_STATUS' });
      return {
        model: { ...m, state: 'RELEASED', pending: [], approvedReqId: e.reqId },
        effects,
      };
    }
    case 'OWNER_KILL':
      return terminate(m, 'CANCELLED', 'CANCELLED');
    case 'TIMER':
      return e.name === 'link' ? terminate(m, 'EXPIRED', 'LINK_EXPIRED') : stay(m);
    default:
      return ownerOrShopWrongState(e, m);
  }
}

function onReleased(m: SessionModel, e: MachineEvent): Transition {
  switch (e.type) {
    case 'SHOP_RENDERED':
      return {
        model: { ...m, state: 'LIVE' },
        effects: [
          { type: 'CANCEL_TIMER', name: 'release' },
          { type: 'START_TIMER', name: 'live', ms: m.rules.liveTtlMs },
          { type: 'SEND_OWNER_STATUS' },
        ],
      };
    case 'SHOP_HELLO':
      return stay(m, [{ type: 'SEND_SHOP_REJECT', reqId: e.reqId, code: 'WRONG_STATE' }]);
    case 'OWNER_KILL':
      return terminate(m, 'DESTROYED', 'OWNER_KILLED');
    case 'SHOP_WIPED':
      return terminate(m, 'DESTROYED', 'SHOP_WIPED', true);
    case 'SHOP_LOST':
    case 'OWNER_LOST':
      return terminate(m, 'ABORTED', 'HEARTBEAT_LOST');
    case 'TIMER':
      return e.name === 'release' ? terminate(m, 'ABORTED', 'RELEASE_TIMEOUT') : stay(m);
    case 'UPLOADED':
    case 'OWNER_APPROVE':
    case 'OWNER_DENY':
      return drop(m, 'owner', 'WRONG_STATE');
    case 'SHOP_PRINT_STARTED':
    case 'SHOP_PRINTED':
      return drop(m, 'shop', 'WRONG_STATE');
    default:
      return stay(m);
  }
}

function onLive(m: SessionModel, e: MachineEvent): Transition {
  switch (e.type) {
    case 'SHOP_PRINT_STARTED': {
      if (m.printing) {
        return drop(m, 'shop', 'WRONG_STATE');
      }
      if (m.printsDone >= m.rules.printLimit) {
        return drop(m, 'shop', 'LIMIT');
      }
      return stay({ ...m, printing: true }, [{ type: 'SEND_OWNER_STATUS' }]);
    }
    case 'SHOP_PRINTED': {
      if (!m.printing) {
        return drop(m, 'shop', 'WRONG_STATE');
      }
      const next: SessionModel = { ...m, printing: false, printsDone: m.printsDone + 1 };
      if (m.rules.destroyAfterPrint && next.printsDone >= m.rules.printLimit) {
        if (m.rules.graceMs === 0) {
          return terminate(next, 'DESTROYED', 'PRINTED');
        }
        return stay(next, [
          { type: 'SEND_OWNER_STATUS' },
          { type: 'START_TIMER', name: 'grace', ms: m.rules.graceMs },
        ]);
      }
      return stay(next, [{ type: 'SEND_OWNER_STATUS' }]);
    }
    case 'TIMER': {
      if (e.name === 'live') {
        return terminate(m, 'DESTROYED', 'LIVE_TIMEOUT');
      }
      if (
        e.name === 'grace' &&
        m.rules.destroyAfterPrint &&
        m.printsDone >= m.rules.printLimit &&
        !m.printing
      ) {
        return terminate(m, 'DESTROYED', 'PRINTED');
      }
      return stay(m);
    }
    case 'OWNER_KILL':
      return terminate(m, 'DESTROYED', 'OWNER_KILLED');
    case 'SHOP_WIPED':
      return terminate(m, 'DESTROYED', 'SHOP_WIPED', true);
    case 'SHOP_LOST':
    case 'OWNER_LOST':
      return terminate(m, 'ABORTED', 'HEARTBEAT_LOST');
    case 'SHOP_HELLO':
      return stay(m, [{ type: 'SEND_SHOP_REJECT', reqId: e.reqId, code: 'WRONG_STATE' }]);
    case 'UPLOADED':
    case 'OWNER_APPROVE':
    case 'OWNER_DENY':
      return drop(m, 'owner', 'WRONG_STATE');
    case 'SHOP_RENDERED':
      return drop(m, 'shop', 'WRONG_STATE');
    default:
      return stay(m);
  }
}

/** The single transition function. Pure and total: it never throws. */
export function reduce(model: SessionModel, event: MachineEvent): Transition {
  if (isTerminalState(model.state)) {
    return onTerminal(model, event);
  }
  switch (model.state) {
    case 'CREATED':
      return onCreated(model, event);
    case 'ARMED':
      return onArmed(model, event);
    case 'AWAITING':
      return onAwaiting(model, event);
    case 'RELEASED':
      return onReleased(model, event);
    case 'LIVE':
      return onLive(model, event);
    default:
      return stay(model);
  }
}

/** Invariants that must hold for every reachable model. Returns a list of violations. */
export function checkInvariants(m: SessionModel): string[] {
  const bad: string[] = [];
  const terminal = isTerminalState(m.state);
  if (m.state !== 'AWAITING' && m.pending.length > 0) {
    bad.push('pending must be empty outside AWAITING');
  }
  if (m.state === 'AWAITING' && m.pending.length === 0) {
    bad.push('AWAITING needs at least one pending request');
  }
  if (m.pending.length > MAX_PENDING_REQUESTS) {
    bad.push('too many pending requests');
  }
  if (new Set(m.pending).size !== m.pending.length) {
    bad.push('duplicate pending request');
  }
  if ((m.state === 'RELEASED' || m.state === 'LIVE') && m.approvedReqId === null) {
    bad.push('RELEASED and LIVE require approvedReqId');
  }
  if (!terminal && m.state !== 'RELEASED' && m.state !== 'LIVE' && m.approvedReqId !== null) {
    bad.push('approvedReqId set before approval');
  }
  if (m.printsDone > m.rules.printLimit) {
    bad.push('printsDone exceeds printLimit');
  }
  if (m.printing && m.state !== 'LIVE') {
    bad.push('printing only valid in LIVE');
  }
  if (terminal !== (m.terminalReason !== null)) {
    bad.push('terminalReason must be set exactly in terminal states');
  }
  return bad;
}
