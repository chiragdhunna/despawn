import { bundleSizeUpperBound, encodeBundle, type Manifest } from '@despawn/bundle';
import {
  base64urlDecode,
  base64urlEncode,
  computeReleaseMac,
  computeSas,
  deriveChannelKey,
  generateEcdhKeyPair,
  generateFileKeyBytes,
  generateLinkSecret,
  generateNoncePrefix,
  importFileKey,
  verifyHelloMac,
  wrapFileKey,
} from '@despawn/crypto';
import {
  HEARTBEAT_INTERVAL_MS,
  MAX_BLOB_BYTES,
  parseCreateSessionResponse,
  parseRelayToOwner,
  serializeOwnerToRelay,
  type OwnerToRelay,
  type Rules,
  type SessionState,
  type TerminalReason,
} from '@despawn/protocol';

export interface RequestView {
  readonly reqId: string;
  readonly browser: string;
  readonly os: string;
  readonly location: string | null;
  readonly sas: string;
  readonly at: number;
}

export type Phase = 'creating' | 'uploading' | 'armed' | 'live' | 'ended' | 'error';

export interface LiveState {
  readonly phase: Phase;
  readonly sessionState: SessionState | null;
  readonly requests: readonly RequestView[];
  /** Remaining time of the current timer, as of receivedAt. */
  readonly remainingMs: number | null;
  readonly receivedAt: number;
  readonly printsDone: number;
  readonly shopSeen: boolean;
  readonly link: string | null;
  readonly online: boolean;
  readonly approvedAt: number | null;
  readonly destroyed: {
    readonly reason: TerminalReason;
    readonly at: number;
    readonly printsDone: number;
    readonly shopReportedWipe: boolean;
  } | null;
  readonly error: string | null;
}

export interface StartParams {
  readonly pages: Uint8Array[];
  readonly manifest: Manifest;
  readonly rules: Rules;
}

const INITIAL: LiveState = {
  phase: 'creating',
  sessionState: null,
  requests: [],
  remainingMs: null,
  receivedAt: 0,
  printsDone: 0,
  shopSeen: false,
  link: null,
  online: false,
  approvedAt: null,
  destroyed: null,
  error: null,
};

/**
 * The owner's side of one session: creates it, uploads the encrypted bundle, keeps the only copy of
 * the file key, verifies and approves shop requests, and can destroy the session at any time.
 */
export class OwnerSession {
  private state: LiveState = INITIAL;
  private ws: WebSocket | null = null;
  private id = '';
  private ownerToken = '';
  private sessionIdBytes: Uint8Array = new Uint8Array();
  private linkSecret: Uint8Array = new Uint8Array();
  private fileKeyRaw: Uint8Array | null = null;
  private seq = 0;
  private hb: ReturnType<typeof setInterval> | null = null;
  private reconnects = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private readonly shopPubs = new Map<string, Uint8Array>();

  constructor(
    private readonly baseUrl: string,
    private readonly onChange: (s: LiveState) => void,
  ) {}

  get current(): LiveState {
    return this.state;
  }

  private set(patch: Partial<LiveState>): void {
    this.state = { ...this.state, ...patch };
    this.onChange(this.state);
  }

  private fail(code: string): void {
    this.zeroKey();
    this.set({ phase: 'error', error: code });
    this.stopTimers();
  }

  private zeroKey(): void {
    this.fileKeyRaw?.fill(0);
    this.fileKeyRaw = null;
  }

  private stopTimers(): void {
    if (this.hb !== null) {
      clearInterval(this.hb);
      this.hb = null;
    }
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  async start(p: StartParams): Promise<void> {
    this.set({ ...INITIAL, phase: 'creating' });
    try {
      const payload = p.pages.reduce((a, b) => a + b.length, 0);
      const bound = bundleSizeUpperBound(payload);
      if (bound > MAX_BLOB_BYTES) {
        this.fail('TOO_LARGE');
        return;
      }
      const res = await fetch(`${this.baseUrl}/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          linkTtlMs: p.rules.linkTtlMs,
          liveTtlMs: p.rules.liveTtlMs,
          printLimit: p.rules.printLimit,
          destroyAfterPrint: p.rules.destroyAfterPrint,
          graceMs: p.rules.graceMs,
          blobBytes: bound,
          verifyEnabled: false,
        }),
      });
      if (!res.ok) {
        this.fail(
          res.status === 429
            ? 'RATE_LIMITED'
            : res.status === 503
              ? 'UNAVAILABLE'
              : 'CREATE_FAILED',
        );
        return;
      }
      const created = parseCreateSessionResponse(await res.json());
      if (!created.ok) {
        this.fail('CREATE_FAILED');
        return;
      }
      this.id = created.msg.sessionId;
      this.ownerToken = created.msg.ownerToken;
      this.sessionIdBytes = base64urlDecode(this.id);
      this.linkSecret = generateLinkSecret();
      this.fileKeyRaw = generateFileKeyBytes();

      this.set({ phase: 'uploading' });
      const bundle = await encodeBundle({
        key: await importFileKey(this.fileKeyRaw, 'encrypt'),
        sessionId: this.sessionIdBytes,
        noncePrefix: generateNoncePrefix(),
        manifest: p.manifest,
        pages: p.pages,
      });
      p.pages.forEach((b) => b.fill(0)); // plaintext pages are no longer needed
      const put = await fetch(`${this.baseUrl}/v1/sessions/${this.id}/blob`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${this.ownerToken}` },
        body: bundle.buffer.slice(
          bundle.byteOffset,
          bundle.byteOffset + bundle.byteLength,
        ) as ArrayBuffer,
      });
      if (put.status !== 204) {
        this.fail('UPLOAD_FAILED');
        return;
      }
      this.set({
        phase: 'armed',
        link: `${this.baseUrl}/s/${this.id}#${base64urlEncode(this.linkSecret)}`,
      });
      this.connect();
    } catch {
      this.fail('NETWORK');
    }
  }

  private wsUrl(): string {
    return `${this.baseUrl.replace(/^http/, 'ws')}/v1/sessions/${this.id}/owner`;
  }

  private connect(): void {
    if (this.disposed || this.state.phase === 'ended' || this.state.phase === 'error') {
      return;
    }
    const ws = new WebSocket(this.wsUrl(), ['despawn.v1', `token.${this.ownerToken}`]);
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.reconnects = 0;
      this.set({ online: true });
      if (this.hb === null) {
        this.hb = setInterval(
          () => this.send({ v: 1, t: 'hb', seq: this.seq++ }),
          HEARTBEAT_INTERVAL_MS,
        );
      }
    });
    ws.addEventListener('message', (e: MessageEvent) => {
      if (typeof e.data === 'string') {
        void this.onFrame(e.data);
      }
    });
    const closed = (): void => {
      if (this.ws !== ws) {
        return;
      }
      this.set({ online: false });
      if (this.state.phase === 'ended' || this.state.phase === 'error' || this.disposed) {
        return;
      }
      if (this.reconnects++ < 60) {
        this.reconnectTimer = setTimeout(() => this.connect(), 1000);
      }
    };
    ws.addEventListener('close', closed);
    ws.addEventListener('error', closed);
  }

  private send(m: OwnerToRelay): void {
    if (this.ws !== null && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(serializeOwnerToRelay(m));
    }
  }

  private async onFrame(text: string): Promise<void> {
    const r = parseRelayToOwner(text);
    if (!r.ok) {
      return;
    }
    const m = r.msg;
    switch (m.t) {
      case 'request': {
        try {
          const shopPub = base64urlDecode(m.shopPub);
          const chan = await deriveChannelKey(this.linkSecret, this.sessionIdBytes);
          const ok = await verifyHelloMac(
            chan,
            this.sessionIdBytes,
            shopPub,
            base64urlDecode(m.mac),
          );
          if (!ok) {
            // Not made with the link secret: someone else, or a tampering relay. Never show it.
            this.send({ v: 1, t: 'deny', reqId: m.reqId });
            return;
          }
          this.shopPubs.set(m.reqId, shopPub);
          const sas = await computeSas(this.sessionIdBytes, shopPub);
          const loc = m.approxLocation;
          const location =
            loc === null
              ? null
              : [loc.region, loc.country].filter((x) => x !== undefined).join(', ') || null;
          const view: RequestView = {
            reqId: m.reqId,
            browser: m.ua.browser,
            os: m.ua.os,
            location,
            sas,
            at: m.at,
          };
          if (!this.state.requests.some((x) => x.reqId === m.reqId)) {
            this.set({ requests: [...this.state.requests, view] });
          }
        } catch {
          this.send({ v: 1, t: 'deny', reqId: m.reqId });
        }
        return;
      }
      case 'requestGone':
        this.set({ requests: this.state.requests.filter((x) => x.reqId !== m.reqId) });
        return;
      case 'status': {
        const live = m.state === 'RELEASED' || m.state === 'LIVE';
        if (live) {
          this.zeroKey();
        }
        this.set({
          sessionState: m.state,
          shopSeen: m.shopSeen,
          printsDone: m.printsDone,
          remainingMs: m.remainingMs,
          receivedAt: Date.now(),
          phase: this.state.phase === 'ended' ? 'ended' : live ? 'live' : 'armed',
          requests: m.pending === 0 ? [] : this.state.requests,
        });
        return;
      }
      case 'destroyed':
        this.zeroKey();
        this.stopTimers();
        this.set({
          phase: 'ended',
          destroyed: {
            reason: m.reason,
            at: m.at,
            printsDone: m.printsDone,
            shopReportedWipe: m.shopReportedWipe,
          },
        });
        this.ws?.close();
        return;
      case 'error':
        return;
    }
  }

  /** Approves one request: wraps the file key for exactly that shop browser. */
  async approve(reqId: string): Promise<boolean> {
    const req = this.state.requests.find((x) => x.reqId === reqId);
    const key = this.fileKeyRaw;
    if (req === undefined || key === null) {
      return false;
    }
    try {
      // Only requests whose hello MAC verified are in shopPubs.
      const shopPub = this.shopPubs.get(reqId);
      if (shopPub === undefined) {
        return false;
      }
      const chan = await deriveChannelKey(this.linkSecret, this.sessionIdBytes);
      const kp = await generateEcdhKeyPair();
      const w = await wrapFileKey({
        ownerPrivateKey: kp.privateKey,
        ownerPublicRaw: kp.publicKeyRaw,
        shopPublicRaw: shopPub,
        sessionId: this.sessionIdBytes,
        fileKey: key,
      });
      const mac2 = await computeReleaseMac(chan, {
        sessionId: this.sessionIdBytes,
        ownerPublicRaw: kp.publicKeyRaw,
        shopPublicRaw: shopPub,
        nonce: w.nonce,
        wrappedKey: w.wrappedKey,
      });
      this.send({
        v: 1,
        t: 'approve',
        reqId,
        ownerPub: base64urlEncode(kp.publicKeyRaw),
        nonce: base64urlEncode(w.nonce),
        wrappedKey: base64urlEncode(w.wrappedKey),
        mac2: base64urlEncode(mac2),
      });
      this.set({ requests: [], approvedAt: Date.now() });
      return true;
    } catch {
      return false;
    }
  }

  deny(reqId: string): void {
    this.send({ v: 1, t: 'deny', reqId });
    this.set({ requests: this.state.requests.filter((x) => x.reqId !== reqId) });
  }

  /** Destroys the session. Works even if the socket is down (falls back to HTTP). */
  async kill(): Promise<void> {
    this.send({ v: 1, t: 'kill' });
    if (this.id !== '' && this.state.phase !== 'ended') {
      try {
        await fetch(`${this.baseUrl}/v1/sessions/${this.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${this.ownerToken}` },
        });
      } catch {
        // the socket kill or the timers will still end it
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.zeroKey();
    this.stopTimers();
    this.ws?.close();
  }
}
