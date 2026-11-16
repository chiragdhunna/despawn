import { base64urlDecode, base64urlEncode, generateSessionId, randomBytes } from '@despawn/crypto';
import {
  BLOB_TOKEN_TTL_MS,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  MAX_FRAME_BYTES,
  MAX_PAGES,
  MAX_PENDING_REQUESTS,
  createSession,
  parseCreateSessionRequest,
  parseOwnerToRelay,
  parseShopToRelay,
  reduce,
  serializeRelayToOwner,
  serializeRelayToShop,
  type ErrorCode,
  type Effect,
  type MachineEvent,
  type OwnerToRelay,
  type Rules,
  type SessionModel,
  type ShopToRelay,
  type ShopToRelayHello,
  type TimerName,
} from '@despawn/protocol';
import type {
  BlobResult,
  BlobStore,
  CreateResult,
  HttpResult,
  Logger,
  RelayConfig,
  RelaySocket,
  Scheduler,
  ShopMeta,
  SocketHandler,
  TimerHandle,
} from './ports.js';

const NOOP_LOGGER: Logger = { event: () => undefined };
const DESTROYED_FLUSH_WAIT_MS = 2500;
const SHOP_CLOSE_DELAY_MS = 3000;
const MAX_BAD_FRAMES = 3;
const MAX_SHOP_CONNECTIONS = 12;
const HELLO_TIMEOUT_MS = 10_000;

export const DEFAULT_CONFIG: RelayConfig = Object.freeze({
  maxBlobBytes: 26214400,
  maxSessionsPerDay: 10000,
  maxActiveSessions: 1000,
});

const HTTP_STATUS: Record<string, number> = {
  BAD_MESSAGE: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  WRONG_STATE: 409,
  TOO_LARGE: 413,
  RATE_LIMITED: 429,
  TOO_MANY_REQUESTS: 429,
  UNAVAILABLE: 503,
};

function fail(code: ErrorCode): { status: number; json: { error: ErrorCode } } {
  return { status: HTTP_STATUS[code] ?? 400, json: { error: code } };
}

function safeEqualB64(a: string, b: string | null): boolean {
  if (b === null) {
    return false;
  }
  let x: Uint8Array;
  let y: Uint8Array;
  try {
    x = base64urlDecode(a);
    y = base64urlDecode(b);
  } catch {
    return false;
  }
  if (x.length !== y.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < x.length; i++) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0;
}

interface ShopConn {
  readonly reqId: string;
  readonly socket: RelaySocket;
  readonly meta: ShopMeta;
  hello: ShopToRelayHello | null;
  helloAt: number;
  badFrames: number;
}

interface ReleaseFields {
  readonly ownerPub: string;
  readonly nonce: string;
  readonly wrappedKey: string;
  readonly mac2: string;
}

class Session {
  model: SessionModel;
  readonly rules: Rules;
  readonly ownerToken: string;
  readonly blobBytes: number;
  ownerSocket: RelaySocket | null = null;
  readonly shops = new Map<string, ShopConn>();
  private readonly timers = new Map<string, { handle: TimerHandle; deadline: number }>();
  private release: ReleaseFields | null = null;
  private blobToken: string | null = null;
  private blobTokenAt = 0;
  private blobUsed = false;
  private lastShopHb = 0;
  private lastOwnerSeen = 0;
  private destroyedPending: { reason: string; at: number } | null = null;
  private finished = false;

  constructor(
    readonly id: string,
    rules: Rules,
    ownerToken: string,
    blobBytes: number,
    private readonly relay: Relay,
  ) {
    this.rules = rules;
    this.ownerToken = ownerToken;
    this.blobBytes = blobBytes;
    const first = createSession(rules);
    this.model = first.model;
    this.exec(first.effects);
  }

  private get sched(): Scheduler {
    return this.relay.deps.scheduler;
  }

  dispatch(event: MachineEvent): void {
    if (this.finished) {
      return;
    }
    const t = reduce(this.model, event);
    this.model = t.model;
    this.exec(t.effects);
  }

  private startTimer(name: string, ms: number, onFire: () => void): void {
    this.timers.get(name)?.handle.cancel();
    const handle = this.sched.setTimeout(onFire, ms);
    this.timers.set(name, { handle, deadline: this.sched.now() + ms });
  }

  private cancelTimer(name: string): void {
    this.timers.get(name)?.handle.cancel();
    this.timers.delete(name);
  }

  private remainingFor(name: string): number | null {
    const t = this.timers.get(name);
    return t === undefined ? null : Math.max(0, t.deadline - this.sched.now());
  }

  /** Remaining time of the timer that matters in the current state. */
  remainingMs(): number | null {
    switch (this.model.state) {
      case 'CREATED':
        return this.remainingFor('upload');
      case 'ARMED':
      case 'AWAITING':
        return this.remainingFor('link');
      case 'RELEASED':
        return this.remainingFor('release');
      case 'LIVE':
        return this.remainingFor('live');
      default:
        return null;
    }
  }

  private sendOwner(build: () => string): void {
    const s = this.ownerSocket;
    if (s !== null && s.isOpen) {
      s.send(build());
    }
  }

  private sendShop(reqId: string, build: () => string): void {
    const c = this.shops.get(reqId);
    if (c !== undefined && c.socket.isOpen) {
      c.socket.send(build());
    }
  }

  private status(): string {
    const approved = this.model.approvedReqId;
    const shopSeen = approved !== null ? this.shops.has(approved) : this.model.pending.length > 0;
    const live = this.model.state === 'RELEASED' || this.model.state === 'LIVE';
    return serializeRelayToOwner({
      v: 1,
      t: 'status',
      state: this.model.state,
      shopSeen,
      lastHbMs: live ? Math.min(86400000, this.sched.now() - this.lastShopHb) : null,
      printsDone: this.model.printsDone,
      remainingMs: this.remainingMs(),
      pending: this.model.pending.length,
    });
  }

  private requestMessage(reqId: string): string | null {
    const c = this.shops.get(reqId);
    if (c === undefined || c.hello === null) {
      return null;
    }
    return serializeRelayToOwner({
      v: 1,
      t: 'request',
      reqId,
      shopPub: c.hello.shopPub,
      mac: c.hello.mac,
      ua: c.hello.ua,
      approxLocation: c.meta.approxCountry === undefined ? null : { country: c.meta.approxCountry },
      at: c.helloAt,
    });
  }

  private flushDestroyed(): void {
    const d = this.destroyedPending;
    if (d === null) {
      return;
    }
    this.destroyedPending = null;
    this.cancelTimer('flush');
    this.sendOwner(() =>
      serializeRelayToOwner({
        v: 1,
        t: 'destroyed',
        reason: d.reason as never,
        at: d.at,
        printsDone: this.model.printsDone,
        shopReportedWipe: this.model.shopReportedWipe,
      }),
    );
    this.finish();
  }

  private finish(): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    for (const name of [...this.timers.keys()]) {
      this.cancelTimer(name);
    }
    const owner = this.ownerSocket;
    this.startTimer('close', SHOP_CLOSE_DELAY_MS, () => {
      for (const c of this.shops.values()) {
        c.socket.close();
      }
      owner?.close();
      this.relay.forget(this.id);
    });
  }

  private exec(effects: readonly Effect[]): void {
    for (const e of effects) {
      switch (e.type) {
        case 'START_TIMER': {
          const name: TimerName = e.name;
          this.startTimer(name, e.ms, () => this.dispatch({ type: 'TIMER', name }));
          break;
        }
        case 'CANCEL_TIMER':
          this.cancelTimer(e.name);
          break;
        case 'CANCEL_ALL_TIMERS':
          for (const name of [...this.timers.keys()]) {
            if (name !== 'flush' && name !== 'close') {
              this.cancelTimer(name);
            }
          }
          break;
        case 'SEND_OWNER_REQUEST': {
          const m = this.requestMessage(e.reqId);
          if (m !== null) {
            this.sendOwner(() => m);
          }
          break;
        }
        case 'SEND_OWNER_REQUEST_GONE':
          this.sendOwner(() => serializeRelayToOwner({ v: 1, t: 'requestGone', reqId: e.reqId }));
          break;
        case 'SEND_OWNER_STATUS':
          this.sendOwner(() => this.status());
          break;
        case 'SEND_OWNER_DESTROYED': {
          this.destroyedPending = { reason: e.reason, at: this.sched.now() };
          const approved = this.model.approvedReqId;
          const waitForShop =
            approved !== null &&
            !this.model.shopReportedWipe &&
            (this.shops.get(approved)?.socket.isOpen ?? false);
          if (waitForShop) {
            this.startTimer('flush', DESTROYED_FLUSH_WAIT_MS, () => this.flushDestroyed());
          } else {
            this.flushDestroyed();
          }
          break;
        }
        case 'SEND_SHOP_DENIED':
          this.sendShop(e.reqId, () => serializeRelayToShop({ v: 1, t: 'denied' }));
          this.closeShopLater(e.reqId);
          break;
        case 'SEND_SHOP_REJECT':
          this.sendShop(e.reqId, () => serializeRelayToShop({ v: 1, t: 'error', code: e.code }));
          this.shops.get(e.reqId)?.socket.close();
          break;
        case 'SEND_SHOP_KILL':
          this.sendShop(e.reqId, () => serializeRelayToShop({ v: 1, t: 'kill', reason: e.reason }));
          break;
        case 'RELEASE_TO_SHOP':
          this.releaseTo(e.reqId);
          break;
        case 'DELETE_BLOB':
          void this.relay.deps.blobs.delete(this.id).catch(() => undefined);
          break;
        case 'REVOKE_BLOB_TOKENS':
          this.blobToken = null;
          break;
        case 'DROP_MESSAGE':
          this.relay.log('drop', { from: e.from, reason: e.reason });
          break;
        case 'WRITE_TOMBSTONE':
          this.relay.log('terminal', { state: e.state, reason: e.reason });
          break;
        case 'SHOP_WIPE_CONFIRMED':
          this.flushDestroyed();
          break;
      }
    }
  }

  private closeShopLater(reqId: string): void {
    const c = this.shops.get(reqId);
    if (c === undefined) {
      return;
    }
    this.sched.setTimeout(() => c.socket.close(), 500);
  }

  private releaseTo(reqId: string): void {
    const rel = this.release;
    if (rel === null) {
      return;
    }
    this.blobToken = base64urlEncode(randomBytes(32));
    this.blobTokenAt = this.sched.now();
    this.blobUsed = false;
    this.lastShopHb = this.sched.now();
    this.lastOwnerSeen = this.sched.now();
    const token = this.blobToken;
    this.sendShop(reqId, () =>
      serializeRelayToShop({
        v: 1,
        t: 'released',
        ownerPub: rel.ownerPub,
        nonce: rel.nonce,
        wrappedKey: rel.wrappedKey,
        mac2: rel.mac2,
        blobToken: token,
        limits: {
          liveTtlMs: this.rules.liveTtlMs,
          printLimit: this.rules.printLimit,
          destroyAfterPrint: this.rules.destroyAfterPrint,
          graceMs: this.rules.graceMs,
        },
      }),
    );
    this.startWatchdog();
  }

  private startWatchdog(): void {
    const tick = (): void => {
      if (this.model.state !== 'RELEASED' && this.model.state !== 'LIVE') {
        return;
      }
      const now = this.sched.now();
      if (now - this.lastShopHb > HEARTBEAT_TIMEOUT_MS) {
        this.dispatch({ type: 'SHOP_LOST' });
        return;
      }
      if (now - this.lastOwnerSeen > HEARTBEAT_TIMEOUT_MS) {
        this.dispatch({ type: 'OWNER_LOST' });
        return;
      }
      this.startTimer('watchdog', HEARTBEAT_INTERVAL_MS / 2, tick);
    };
    this.startTimer('watchdog', HEARTBEAT_INTERVAL_MS / 2, tick);
  }

  ownerAlive(): boolean {
    const s = this.ownerSocket;
    return (
      s !== null && s.isOpen && this.sched.now() - this.lastOwnerSeen <= HEARTBEAT_INTERVAL_MS * 2.5
    );
  }

  // ---- owner side ----

  attachOwner(socket: RelaySocket): SocketHandler {
    this.ownerSocket?.close();
    this.ownerSocket = socket;
    this.lastOwnerSeen = this.sched.now();
    socket.send(this.status());
    for (const reqId of this.model.pending) {
      const m = this.requestMessage(reqId);
      if (m !== null) {
        socket.send(m);
      }
    }
    let bad = 0;
    return {
      onMessage: (text) => {
        if (this.ownerSocket !== socket) {
          return;
        }
        const r = parseOwnerToRelay(text);
        if (!r.ok) {
          socket.send(serializeRelayToOwner({ v: 1, t: 'error', code: r.code }));
          if (++bad >= MAX_BAD_FRAMES) {
            socket.close();
          }
          return;
        }
        this.lastOwnerSeen = this.sched.now();
        this.onOwnerMessage(r.msg);
      },
      onClose: () => {
        if (this.ownerSocket === socket) {
          this.ownerSocket = null;
        }
      },
    };
  }

  private onOwnerMessage(m: OwnerToRelay): void {
    switch (m.t) {
      case 'hb':
        return;
      case 'kill':
        this.dispatch({ type: 'OWNER_KILL' });
        return;
      case 'deny':
        this.dispatch({ type: 'OWNER_DENY', reqId: m.reqId });
        return;
      case 'approve':
        this.release = {
          ownerPub: m.ownerPub,
          nonce: m.nonce,
          wrappedKey: m.wrappedKey,
          mac2: m.mac2,
        };
        this.dispatch({ type: 'OWNER_APPROVE', reqId: m.reqId });
        if (this.model.approvedReqId !== m.reqId) {
          this.release = null;
        }
        return;
    }
  }

  // ---- shop side ----

  attachShop(socket: RelaySocket, meta: ShopMeta): SocketHandler | null {
    if (this.finished || this.shops.size >= MAX_SHOP_CONNECTIONS) {
      return null;
    }
    const reqId = base64urlEncode(randomBytes(16));
    const conn: ShopConn = { reqId, socket, meta, hello: null, helloAt: 0, badFrames: 0 };
    this.shops.set(reqId, conn);
    // A connection that never says hello must not linger.
    this.sched.setTimeout(() => {
      if (conn.hello === null && socket.isOpen) {
        socket.close();
      }
    }, HELLO_TIMEOUT_MS);
    return {
      onMessage: (text) => this.onShopFrame(conn, text),
      onClose: () => this.onShopClosed(conn),
    };
  }

  private onShopFrame(conn: ShopConn, text: string): void {
    const r = parseShopToRelay(text);
    if (!r.ok) {
      conn.socket.send(serializeRelayToShop({ v: 1, t: 'error', code: r.code }));
      if (++conn.badFrames >= MAX_BAD_FRAMES) {
        conn.socket.close();
      }
      return;
    }
    const m: ShopToRelay = r.msg;
    if (m.t === 'hello') {
      if (conn.hello !== null) {
        this.relay.log('drop', { from: 'shop', reason: 'WRONG_STATE' });
        return;
      }
      conn.hello = m;
      conn.helloAt = this.sched.now();
      this.dispatch({ type: 'SHOP_HELLO', reqId: conn.reqId });
      return;
    }
    if (m.t === 'hb') {
      if (conn.reqId === this.model.approvedReqId) {
        this.lastShopHb = this.sched.now();
      }
      conn.socket.send(
        serializeRelayToShop({
          v: 1,
          t: 'tick',
          ownerAlive: this.ownerAlive(),
          remainingMs: conn.reqId === this.model.approvedReqId ? this.remainingMs() : null,
        }),
      );
      return;
    }
    if (conn.reqId !== this.model.approvedReqId && !this.isTerminalAndWasApproved(conn)) {
      this.relay.log('drop', { from: 'shop', reason: 'WRONG_STATE' });
      return;
    }
    switch (m.t) {
      case 'rendered':
        this.dispatch({ type: 'SHOP_RENDERED' });
        return;
      case 'printStarted':
        this.dispatch({ type: 'SHOP_PRINT_STARTED' });
        return;
      case 'printed':
        this.dispatch({ type: 'SHOP_PRINTED' });
        return;
      case 'wiped':
        this.dispatch({ type: 'SHOP_WIPED', reason: m.reason });
        return;
    }
  }

  private isTerminalAndWasApproved(conn: ShopConn): boolean {
    return this.model.approvedReqId === conn.reqId;
  }

  private onShopClosed(conn: ShopConn): void {
    if (this.model.pending.includes(conn.reqId)) {
      this.dispatch({ type: 'SHOP_REQUEST_DROPPED', reqId: conn.reqId });
    } else if (
      conn.reqId === this.model.approvedReqId &&
      (this.model.state === 'RELEASED' || this.model.state === 'LIVE')
    ) {
      this.dispatch({ type: 'SHOP_LOST' });
    }
    if (this.model.state !== 'RELEASED' && this.model.state !== 'LIVE') {
      this.shops.delete(conn.reqId);
    }
  }

  // ---- http side ----

  putBlob(token: string, data: Uint8Array): HttpResult {
    if (!safeEqualB64(token, this.ownerToken)) {
      return fail('FORBIDDEN');
    }
    if (this.model.state !== 'CREATED') {
      return fail('WRONG_STATE');
    }
    if (data.length === 0 || data.length > this.blobBytes) {
      return fail('TOO_LARGE');
    }
    return { status: 204 };
  }

  markUploaded(): void {
    this.dispatch({ type: 'UPLOADED' });
  }

  takeBlobToken(token: string): boolean {
    const live = this.model.state === 'RELEASED' || this.model.state === 'LIVE';
    if (
      !live ||
      this.blobUsed ||
      !safeEqualB64(token, this.blobToken) ||
      this.sched.now() - this.blobTokenAt > BLOB_TOKEN_TTL_MS
    ) {
      return false;
    }
    this.blobUsed = true;
    return true;
  }

  authOwner(token: string): boolean {
    return safeEqualB64(token, this.ownerToken);
  }

  kill(): void {
    this.dispatch({ type: 'OWNER_KILL' });
  }

  isFinished(): boolean {
    return this.finished;
  }
}

export interface RelayDeps {
  readonly blobs: BlobStore;
  readonly scheduler: Scheduler;
  readonly config?: Partial<RelayConfig> | undefined;
  readonly logger?: Logger | undefined;
}

export class Relay {
  readonly deps: RelayDeps;
  readonly config: RelayConfig;
  private readonly sessions = new Map<string, Session>();
  private dayStart = 0;
  private createdToday = 0;

  constructor(deps: RelayDeps) {
    this.deps = deps;
    this.config = { ...DEFAULT_CONFIG, ...deps.config };
  }

  log(name: string, fields?: Record<string, string | number | boolean>): void {
    (this.deps.logger ?? NOOP_LOGGER).event(name, fields);
  }

  forget(id: string): void {
    this.sessions.delete(id);
  }

  /** Counts for health checks and tests. Never exposes ids or content. */
  stats(): { sessions: number } {
    return { sessions: this.sessions.size };
  }

  private find(id: string): Session | null {
    return this.sessions.get(id) ?? null;
  }

  async createSession(body: unknown): Promise<CreateResult> {
    const parsed = parseCreateSessionRequest(body);
    if (!parsed.ok) {
      return fail('BAD_MESSAGE');
    }
    const req = parsed.msg;
    if (this.config.verifyChallenge !== undefined) {
      const ok = await this.config.verifyChallenge(req.challengeToken);
      if (!ok) {
        return fail('FORBIDDEN');
      }
    }
    if (req.blobBytes > this.config.maxBlobBytes) {
      return fail('TOO_LARGE');
    }
    const now = this.deps.scheduler.now();
    if (now - this.dayStart > 86400000) {
      this.dayStart = now;
      this.createdToday = 0;
    }
    if (this.createdToday >= this.config.maxSessionsPerDay) {
      return fail('RATE_LIMITED');
    }
    if (this.sessions.size >= this.config.maxActiveSessions) {
      return fail('UNAVAILABLE');
    }
    this.createdToday++;
    const id = base64urlEncode(generateSessionId());
    const ownerToken = base64urlEncode(randomBytes(32));
    const rules: Rules = {
      linkTtlMs: req.linkTtlMs,
      liveTtlMs: req.liveTtlMs,
      printLimit: req.printLimit,
      destroyAfterPrint: req.destroyAfterPrint,
      graceMs: req.graceMs,
    };
    this.sessions.set(id, new Session(id, rules, ownerToken, req.blobBytes, this));
    this.log('created', {});
    return {
      status: 201,
      json: {
        sessionId: id,
        ownerToken,
        limits: {
          maxBlobBytes: this.config.maxBlobBytes,
          maxPages: MAX_PAGES,
          maxFrameBytes: MAX_FRAME_BYTES,
          maxPendingRequests: MAX_PENDING_REQUESTS,
        },
      },
    };
  }

  async putBlob(id: string, ownerToken: string, data: Uint8Array): Promise<HttpResult> {
    const s = this.find(id);
    if (s === null) {
      return fail('NOT_FOUND');
    }
    const check = s.putBlob(ownerToken, data);
    if (check.status !== 204) {
      return check;
    }
    await this.deps.blobs.put(id, data);
    s.markUploaded();
    return { status: 204 };
  }

  async getBlob(id: string, blobToken: string): Promise<BlobResult> {
    const s = this.find(id);
    if (s === null || !s.takeBlobToken(blobToken)) {
      return { status: 404 };
    }
    const data = await this.deps.blobs.get(id);
    // One-time download: the ciphertext is deleted as soon as it has been handed out.
    await this.deps.blobs.delete(id).catch(() => undefined);
    return data === null ? { status: 404 } : { status: 200, body: data };
  }

  deleteSession(id: string, ownerToken: string): HttpResult {
    const s = this.find(id);
    if (s === null) {
      return fail('NOT_FOUND');
    }
    if (!s.authOwner(ownerToken)) {
      return fail('FORBIDDEN');
    }
    s.kill();
    return { status: 204 };
  }

  attachOwner(id: string, ownerToken: string, socket: RelaySocket): SocketHandler | null {
    const s = this.find(id);
    if (s === null || s.isFinished() || !s.authOwner(ownerToken)) {
      return null;
    }
    return s.attachOwner(socket);
  }

  attachShop(id: string, socket: RelaySocket, meta: ShopMeta): SocketHandler | null {
    const s = this.find(id);
    return s === null ? null : s.attachShop(socket, meta);
  }

  /** Terminates every session (graceful shutdown). */
  shutdown(): void {
    for (const s of [...this.sessions.values()]) {
      s.kill();
    }
  }
}
