import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULES,
  MAX_PENDING_REQUESTS,
  RELEASE_TIMEOUT_MS,
  SESSION_STATES,
  UPLOAD_TIMEOUT_MS,
  checkInvariants,
  createSession,
  isTerminalState,
  reduce,
  type Effect,
  type MachineEvent,
  type Rules,
  type SessionModel,
} from './index.js';

const last = <T>(a: readonly T[]): T | undefined => a[a.length - 1];
const types = (effects: readonly Effect[]): string[] => effects.map((e) => e.type);

/** Runs events from a fresh session and returns the final model plus all effects. */
function run(events: MachineEvent[], rules: Rules = DEFAULT_RULES) {
  const first = createSession(rules);
  let model = first.model;
  const all: Effect[] = [...first.effects];
  for (const e of events) {
    const t = reduce(model, e);
    model = t.model;
    all.push(...t.effects);
  }
  return { model, effects: all };
}

const A = 'req-A';
const B = 'req-B';
const armed: MachineEvent[] = [{ type: 'UPLOADED' }];
const awaiting: MachineEvent[] = [...armed, { type: 'SHOP_HELLO', reqId: A }];
const released: MachineEvent[] = [...awaiting, { type: 'OWNER_APPROVE', reqId: A }];
const live: MachineEvent[] = [...released, { type: 'SHOP_RENDERED' }];

describe('createSession', () => {
  it('starts in CREATED with an upload timer', () => {
    const t = createSession(DEFAULT_RULES);
    expect(t.model.state).toBe('CREATED');
    expect(t.effects).toEqual([{ type: 'START_TIMER', name: 'upload', ms: UPLOAD_TIMEOUT_MS }]);
    expect(checkInvariants(t.model)).toEqual([]);
  });
});

describe('happy path', () => {
  it('walks CREATED to ARMED to AWAITING to RELEASED to LIVE to DESTROYED(PRINTED)', () => {
    const s = run([
      ...live,
      { type: 'SHOP_PRINT_STARTED' },
      { type: 'SHOP_PRINTED' },
      { type: 'TIMER', name: 'grace' },
    ]);
    expect(s.model.state).toBe('DESTROYED');
    expect(s.model.terminalReason).toBe('PRINTED');
    expect(s.model.printsDone).toBe(1);
    expect(types(s.effects)).toContain('RELEASE_TO_SHOP');
  });

  it('starts the link timer when armed and the live timer when rendered', () => {
    expect(run(armed).effects).toContainEqual({
      type: 'START_TIMER',
      name: 'link',
      ms: DEFAULT_RULES.linkTtlMs,
    });
    expect(run(live).effects).toContainEqual({
      type: 'START_TIMER',
      name: 'live',
      ms: DEFAULT_RULES.liveTtlMs,
    });
    expect(run(released).effects).toContainEqual({
      type: 'START_TIMER',
      name: 'release',
      ms: RELEASE_TIMEOUT_MS,
    });
  });

  it('graceMs 0 destroys immediately after the last print', () => {
    const s = run([...live, { type: 'SHOP_PRINT_STARTED' }, { type: 'SHOP_PRINTED' }], {
      ...DEFAULT_RULES,
      graceMs: 0,
    });
    expect(s.model.state).toBe('DESTROYED');
    expect(s.model.terminalReason).toBe('PRINTED');
  });

  it('with destroyAfterPrint off, the session stays LIVE after printing until the live timer', () => {
    const rules = { ...DEFAULT_RULES, destroyAfterPrint: false };
    const s = run([...live, { type: 'SHOP_PRINT_STARTED' }, { type: 'SHOP_PRINTED' }], rules);
    expect(s.model.state).toBe('LIVE');
    expect(reduce(s.model, { type: 'TIMER', name: 'grace' }).model.state).toBe('LIVE');
    expect(reduce(s.model, { type: 'TIMER', name: 'live' }).model.terminalReason).toBe(
      'LIVE_TIMEOUT',
    );
  });

  it('allows several prints up to printLimit and destroys only after the last', () => {
    const rules = { ...DEFAULT_RULES, printLimit: 2 };
    const s1 = run([...live, { type: 'SHOP_PRINT_STARTED' }, { type: 'SHOP_PRINTED' }], rules);
    expect(s1.model.state).toBe('LIVE');
    expect(s1.effects.some((e) => e.type === 'START_TIMER' && e.name === 'grace')).toBe(false);
    const s2 = reduce(reduce(s1.model, { type: 'SHOP_PRINT_STARTED' }).model, {
      type: 'SHOP_PRINTED',
    });
    expect(s2.effects).toContainEqual({ type: 'START_TIMER', name: 'grace', ms: rules.graceMs });
  });
});

describe('approval rules', () => {
  it('approving one request denies all others and releases only the approved one', () => {
    const s = run([
      ...awaiting,
      { type: 'SHOP_HELLO', reqId: B },
      { type: 'OWNER_APPROVE', reqId: B },
    ]);
    expect(s.model.state).toBe('RELEASED');
    expect(s.model.approvedReqId).toBe(B);
    expect(s.effects.filter((e) => e.type === 'RELEASE_TO_SHOP')).toEqual([
      { type: 'RELEASE_TO_SHOP', reqId: B },
    ]);
    expect(s.effects).toContainEqual({ type: 'SEND_SHOP_DENIED', reqId: A });
  });

  it('a second approval is dropped and never releases again', () => {
    const s = run([...released, { type: 'OWNER_APPROVE', reqId: B }]);
    expect(s.effects.filter((e) => e.type === 'RELEASE_TO_SHOP')).toHaveLength(1);
    expect(last(s.effects)).toEqual({
      type: 'DROP_MESSAGE',
      from: 'owner',
      reason: 'WRONG_STATE',
    });
  });

  it('approving an unknown request is dropped', () => {
    const s = run([...awaiting, { type: 'OWNER_APPROVE', reqId: 'nope' }]);
    expect(s.model.state).toBe('AWAITING');
    expect(last(s.effects)).toEqual({
      type: 'DROP_MESSAGE',
      from: 'owner',
      reason: 'UNKNOWN_REQUEST',
    });
  });

  it('denying the last pending request returns to ARMED', () => {
    const s = run([...awaiting, { type: 'OWNER_DENY', reqId: A }]);
    expect(s.model.state).toBe('ARMED');
    expect(s.effects).toContainEqual({ type: 'SEND_SHOP_DENIED', reqId: A });
  });

  it('a shop that goes away while pending is reported as requestGone', () => {
    const s = run([...awaiting, { type: 'SHOP_REQUEST_DROPPED', reqId: A }]);
    expect(s.model.state).toBe('ARMED');
    expect(s.effects).toContainEqual({ type: 'SEND_OWNER_REQUEST_GONE', reqId: A });
  });

  it('caps pending requests', () => {
    const events: MachineEvent[] = [...armed];
    for (let i = 0; i < MAX_PENDING_REQUESTS; i++) {
      events.push({ type: 'SHOP_HELLO', reqId: `r${i}` });
    }
    events.push({ type: 'SHOP_HELLO', reqId: 'extra' });
    const s = run(events);
    expect(s.model.pending).toHaveLength(MAX_PENDING_REQUESTS);
    expect(last(s.effects)).toEqual({
      type: 'SEND_SHOP_REJECT',
      reqId: 'extra',
      code: 'TOO_MANY_REQUESTS',
    });
  });

  it('a link is single use: hello after release is rejected', () => {
    const s = run([...released, { type: 'SHOP_HELLO', reqId: B }]);
    expect(last(s.effects)).toEqual({ type: 'SEND_SHOP_REJECT', reqId: B, code: 'WRONG_STATE' });
    expect(s.model.state).toBe('RELEASED');
  });
});

describe('every way out ends in a terminal state with full cleanup', () => {
  const cases: Array<[string, MachineEvent[], string, string]> = [
    ['owner kill before upload', [{ type: 'OWNER_KILL' }], 'CANCELLED', 'CANCELLED'],
    ['upload timeout', [{ type: 'TIMER', name: 'upload' }], 'EXPIRED', 'LINK_EXPIRED'],
    ['owner kill when armed', [...armed, { type: 'OWNER_KILL' }], 'CANCELLED', 'CANCELLED'],
    [
      'link expiry when armed',
      [...armed, { type: 'TIMER', name: 'link' }],
      'EXPIRED',
      'LINK_EXPIRED',
    ],
    ['owner kill when awaiting', [...awaiting, { type: 'OWNER_KILL' }], 'CANCELLED', 'CANCELLED'],
    [
      'link expiry when awaiting',
      [...awaiting, { type: 'TIMER', name: 'link' }],
      'EXPIRED',
      'LINK_EXPIRED',
    ],
    [
      'owner kill when released',
      [...released, { type: 'OWNER_KILL' }],
      'DESTROYED',
      'OWNER_KILLED',
    ],
    [
      'release timeout',
      [...released, { type: 'TIMER', name: 'release' }],
      'ABORTED',
      'RELEASE_TIMEOUT',
    ],
    ['shop lost when released', [...released, { type: 'SHOP_LOST' }], 'ABORTED', 'HEARTBEAT_LOST'],
    [
      'owner lost when released',
      [...released, { type: 'OWNER_LOST' }],
      'ABORTED',
      'HEARTBEAT_LOST',
    ],
    [
      'shop wiped when released',
      [...released, { type: 'SHOP_WIPED', reason: 'ERROR' }],
      'DESTROYED',
      'SHOP_WIPED',
    ],
    ['owner kill when live', [...live, { type: 'OWNER_KILL' }], 'DESTROYED', 'OWNER_KILLED'],
    ['live timeout', [...live, { type: 'TIMER', name: 'live' }], 'DESTROYED', 'LIVE_TIMEOUT'],
    ['shop lost when live', [...live, { type: 'SHOP_LOST' }], 'ABORTED', 'HEARTBEAT_LOST'],
    ['owner lost when live', [...live, { type: 'OWNER_LOST' }], 'ABORTED', 'HEARTBEAT_LOST'],
    [
      'shop wiped when live',
      [...live, { type: 'SHOP_WIPED', reason: 'USER_CLOSED' }],
      'DESTROYED',
      'SHOP_WIPED',
    ],
  ];
  for (const [name, events, state, reason] of cases) {
    it(name, () => {
      const s = run(events);
      expect(s.model.state).toBe(state);
      expect(s.model.terminalReason).toBe(reason);
      // exact terminal effect order (docs/STATE_MACHINE.md section 5)
      const tail = s.effects.slice(s.effects.findIndex((e) => e.type === 'CANCEL_ALL_TIMERS'));
      const order = types(tail);
      expect(order.slice(0, 3)).toEqual(['CANCEL_ALL_TIMERS', 'DELETE_BLOB', 'REVOKE_BLOB_TOKENS']);
      expect(order.slice(-2)).toEqual(['SEND_OWNER_DESTROYED', 'WRITE_TOMBSTONE']);
      expect(s.effects.filter((e) => e.type === 'DELETE_BLOB')).toHaveLength(1);
      expect(checkInvariants(s.model)).toEqual([]);
    });
  }

  it('pending shops are told to stop when the session is cancelled', () => {
    const s = run([...awaiting, { type: 'SHOP_HELLO', reqId: B }, { type: 'OWNER_KILL' }]);
    expect(s.effects.filter((e) => e.type === 'SEND_SHOP_KILL')).toEqual([
      { type: 'SEND_SHOP_KILL', reqId: A, reason: 'CANCELLED' },
      { type: 'SEND_SHOP_KILL', reqId: B, reason: 'CANCELLED' },
    ]);
  });
});

describe('terminal states are absorbing', () => {
  it('ignore everything except a late wipe confirmation, and reject hello with NOT_FOUND', () => {
    const dead = run([...live, { type: 'OWNER_KILL' }]).model;
    const events: MachineEvent[] = [
      { type: 'UPLOADED' },
      { type: 'OWNER_APPROVE', reqId: A },
      { type: 'OWNER_DENY', reqId: A },
      { type: 'OWNER_KILL' },
      { type: 'OWNER_LOST' },
      { type: 'SHOP_RENDERED' },
      { type: 'SHOP_PRINT_STARTED' },
      { type: 'SHOP_PRINTED' },
      { type: 'SHOP_LOST' },
      { type: 'TIMER', name: 'live' },
      { type: 'SHOP_REQUEST_DROPPED', reqId: A },
    ];
    for (const e of events) {
      const t = reduce(dead, e);
      expect(t.model).toEqual(dead);
      expect(t.effects).toEqual([]);
    }
    expect(reduce(dead, { type: 'SHOP_HELLO', reqId: B }).effects).toEqual([
      { type: 'SEND_SHOP_REJECT', reqId: B, code: 'NOT_FOUND' },
    ]);
    const late = reduce(dead, { type: 'SHOP_WIPED', reason: 'KILLED' });
    expect(late.model.state).toBe('DESTROYED');
    expect(late.model.shopReportedWipe).toBe(true);
    expect(late.effects).toEqual([{ type: 'SHOP_WIPE_CONFIRMED' }]);
    expect(reduce(late.model, { type: 'SHOP_WIPED', reason: 'KILLED' }).effects).toEqual([]);
  });
});

describe('printing rules', () => {
  it('rejects a second printStarted while printing and a print past the limit', () => {
    const p = run([...live, { type: 'SHOP_PRINT_STARTED' }]);
    expect(reduce(p.model, { type: 'SHOP_PRINT_STARTED' }).effects).toEqual([
      { type: 'DROP_MESSAGE', from: 'shop', reason: 'WRONG_STATE' },
    ]);
    const done = run([...live, { type: 'SHOP_PRINT_STARTED' }, { type: 'SHOP_PRINTED' }]);
    expect(reduce(done.model, { type: 'SHOP_PRINT_STARTED' }).effects).toEqual([
      { type: 'DROP_MESSAGE', from: 'shop', reason: 'LIMIT' },
    ]);
  });

  it('printed without printStarted is dropped', () => {
    const s = run([...live, { type: 'SHOP_PRINTED' }]);
    expect(s.model.printsDone).toBe(0);
    expect(last(s.effects)).toEqual({ type: 'DROP_MESSAGE', from: 'shop', reason: 'WRONG_STATE' });
  });
});

describe('totality, purity and invariants', () => {
  const EVENTS: MachineEvent[] = [
    { type: 'UPLOADED' },
    { type: 'SHOP_HELLO', reqId: A },
    { type: 'SHOP_HELLO', reqId: B },
    { type: 'SHOP_REQUEST_DROPPED', reqId: A },
    { type: 'OWNER_APPROVE', reqId: A },
    { type: 'OWNER_APPROVE', reqId: B },
    { type: 'OWNER_DENY', reqId: A },
    { type: 'OWNER_KILL' },
    { type: 'OWNER_LOST' },
    { type: 'SHOP_RENDERED' },
    { type: 'SHOP_PRINT_STARTED' },
    { type: 'SHOP_PRINTED' },
    { type: 'SHOP_WIPED', reason: 'ERROR' },
    { type: 'SHOP_LOST' },
    { type: 'TIMER', name: 'upload' },
    { type: 'TIMER', name: 'link' },
    { type: 'TIMER', name: 'release' },
    { type: 'TIMER', name: 'live' },
    { type: 'TIMER', name: 'grace' },
  ];

  const deepFreeze = <T>(o: T): T => {
    if (o && typeof o === 'object') {
      Object.freeze(o);
      for (const v of Object.values(o as object)) deepFreeze(v);
    }
    return o;
  };

  it('every state x event pair is defined, pure and keeps invariants (frozen inputs)', () => {
    const reachable = new Map<string, SessionModel>();
    const prefixes: MachineEvent[][] = [
      [],
      armed,
      awaiting,
      [...awaiting, { type: 'SHOP_HELLO', reqId: B }],
      released,
      live,
      [...live, { type: 'SHOP_PRINT_STARTED' }],
      [...live, { type: 'SHOP_PRINT_STARTED' }, { type: 'SHOP_PRINTED' }],
      [...live, { type: 'OWNER_KILL' }],
      [...released, { type: 'SHOP_LOST' }],
      [{ type: 'TIMER', name: 'upload' }],
      [...armed, { type: 'OWNER_KILL' }],
      [...armed, { type: 'TIMER', name: 'link' }],
    ];
    for (const p of prefixes) {
      const m = run(p).model;
      reachable.set(JSON.stringify(m), m);
    }
    const seenStates = new Set([...reachable.values()].map((m) => m.state));
    for (const s of SESSION_STATES) expect(seenStates.has(s)).toBe(true);
    for (const m of reachable.values()) {
      deepFreeze(m);
      for (const e of EVENTS) {
        const before = JSON.stringify(m);
        const t1 = reduce(m, e);
        const t2 = reduce(m, e);
        expect(t2).toEqual(t1);
        expect(JSON.stringify(m)).toBe(before);
        expect(checkInvariants(t1.model)).toEqual([]);
      }
    }
  });

  it('random walks of 40000 events keep every invariant and never release twice', () => {
    let seed = 0x5eed;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let walk = 0; walk < 400; walk++) {
      const rules: Rules = {
        ...DEFAULT_RULES,
        printLimit: 1 + Math.floor(rnd() * 3),
        graceMs: rnd() < 0.3 ? 0 : 10000,
        destroyAfterPrint: rnd() < 0.8,
      };
      let { model } = createSession(rules);
      let releases = 0;
      let blobDeletes = 0;
      let terminalEntered = 0;
      for (let i = 0; i < 100; i++) {
        const e = EVENTS[Math.floor(rnd() * EVENTS.length)]!;
        const wasTerminal = isTerminalState(model.state);
        const t = reduce(model, e);
        releases += t.effects.filter((x) => x.type === 'RELEASE_TO_SHOP').length;
        blobDeletes += t.effects.filter((x) => x.type === 'DELETE_BLOB').length;
        if (!wasTerminal && isTerminalState(t.model.state)) terminalEntered++;
        if (wasTerminal) expect(t.model.state).toBe(model.state);
        expect(checkInvariants(t.model)).toEqual([]);
        model = t.model;
      }
      expect(releases).toBeLessThanOrEqual(1);
      expect(blobDeletes).toBe(terminalEntered);
      expect(terminalEntered).toBeLessThanOrEqual(1);
    }
  });

  it("liveness: from every reachable non-terminal model, firing that state's timers ends the session", () => {
    const models = [
      run([]).model,
      run(armed).model,
      run(awaiting).model,
      run(released).model,
      run(live).model,
      run([...live, { type: 'SHOP_PRINT_STARTED' }]).model,
    ];
    for (const m of models) {
      let cur = m;
      for (const name of ['upload', 'link', 'release', 'live'] as const) {
        cur = reduce(cur, { type: 'TIMER', name }).model;
      }
      expect(isTerminalState(cur.state)).toBe(true);
    }
  });
});
