import { decodeBundle, type Manifest } from '@despawn/bundle';
import {
  base64urlDecode,
  base64urlEncode,
  computeHelloMac,
  computeSas,
  deriveChannelKey,
  generateEcdhKeyPair,
  unwrapFileKey,
  verifyReleaseMac,
  type EcdhKeyPair,
} from '@despawn/crypto';
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  parseRelayToShop,
  serializeShopToRelay,
  type RelayToShop,
  type ShopToRelay,
  type ShopViewState,
  type ShopWipeReason,
} from '@despawn/protocol';
import type { StringKey } from './i18n.js';
import { parseLink, type ParsedLink } from './link.js';
import { describeBrowser } from './ua.js';
import type { PageView, Ui } from './ui.js';

type Phase =
  'connecting' | 'waiting' | 'preparing' | 'ready' | 'printing' | 'confirm' | 'finishing' | 'dead';

const PRINT_FALLBACK_MS = 30_000;
const SLOW_MS = 15_000;

function reasonKey(reason: string): StringKey {
  const key = `reason.${reason}` as StringKey;
  return key;
}

/** One shop-side session: handshake, decrypt in memory, print, wipe. Nothing is ever stored. */
export class ViewerSession {
  private phase: Phase = 'connecting';
  private link: ParsedLink | null = null;
  private ws: WebSocket | null = null;
  private kp: EcdhKeyPair | null = null;
  private chanKey: CryptoKey | null = null;
  private pageUrls: string[] = [];
  private manifest: Manifest | null = null;
  private limits = { liveTtlMs: 120000, printLimit: 1, destroyAfterPrint: true };
  private printsConfirmed = 0;
  private printStartedSent = false;
  private remainingMs: number | null = null;
  private ownerAlive = true;
  private lastRx = Date.now();
  private hbSeq = 0;
  private timers: number[] = [];
  private printTimer: number | null = null;
  private printEvents = 0;

  constructor(
    private readonly ui: Ui,
    private readonly env: {
      pathname: string;
      hash: string;
      userAgent: string;
      wsBase: string;
      httpBase: string;
    },
  ) {}

  async start(): Promise<void> {
    const nav = window;
    if (nav.isSecureContext === false) {
      this.phase = 'dead';
      this.ui.message('insecure');
      return;
    }
    if (
      nav.crypto === undefined ||
      nav.crypto.subtle === undefined ||
      typeof nav.WebSocket !== 'function' ||
      typeof nav.fetch !== 'function' ||
      typeof URL.createObjectURL !== 'function'
    ) {
      this.phase = 'dead';
      this.ui.message('unsupported');
      return;
    }
    this.link = parseLink(this.env.pathname, this.env.hash);
    // The link secret must not stay in the address bar or in history.
    try {
      window.history.replaceState(null, '', this.env.pathname);
    } catch {
      // not fatal
    }
    if (this.link === null) {
      this.phase = 'dead';
      this.ui.message('invalid');
      return;
    }
    this.ui.connecting();
    let sas: string;
    let helloMac: Uint8Array;
    try {
      this.kp = await generateEcdhKeyPair();
      this.chanKey = await deriveChannelKey(
        this.link.linkSecret,
        base64urlDecode(this.link.sessionId),
      );
      helloMac = await computeHelloMac(
        this.chanKey,
        base64urlDecode(this.link.sessionId),
        this.kp.publicKeyRaw,
      );
      sas = await computeSas(base64urlDecode(this.link.sessionId), this.kp.publicKeyRaw);
    } catch {
      this.phase = 'dead';
      this.ui.message('unsupported');
      return;
    }
    const socket = new WebSocket(`${this.env.wsBase}/v1/sessions/${this.link.sessionId}/shop`, [
      'despawn.v1',
    ]);
    this.ws = socket;
    socket.addEventListener('open', () => {
      this.lastRx = Date.now();
      const ua = describeBrowser(this.env.userAgent);
      this.send({
        v: 1,
        t: 'hello',
        shopPub: base64urlEncode(this.kp?.publicKeyRaw ?? new Uint8Array()),
        mac: base64urlEncode(helloMac),
        ua,
      });
      this.phase = 'waiting';
      this.ui.waiting(sas);
      this.startTimers();
    });
    socket.addEventListener('message', (e: MessageEvent) => {
      this.lastRx = Date.now();
      if (typeof e.data !== 'string') {
        return;
      }
      const r = parseRelayToShop(e.data);
      if (r.ok) {
        void this.onMessage(r.msg);
      }
    });
    socket.addEventListener('close', () => this.onClosed());
    socket.addEventListener('error', () => this.onClosed());
    window.addEventListener('pagehide', () => {
      if (this.isPostRelease()) {
        this.wipe('USER_CLOSED', 'reason.SHOP_WIPED');
      }
    });
  }

  private isPostRelease(): boolean {
    return (
      this.phase === 'preparing' ||
      this.phase === 'ready' ||
      this.phase === 'printing' ||
      this.phase === 'confirm' ||
      this.phase === 'finishing'
    );
  }

  private send(m: ShopToRelay): void {
    const ws = this.ws;
    if (ws !== null && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(serializeShopToRelay(m));
      } catch {
        // an invalid or oversized message is a bug, never leak details
      }
    }
  }

  private viewState(): ShopViewState {
    switch (this.phase) {
      case 'connecting':
      case 'waiting':
        return 'WAITING';
      case 'preparing':
        return 'DECRYPTING';
      case 'printing':
        return 'PRINTING';
      case 'dead':
        return 'WIPED';
      default:
        return 'READY';
    }
  }

  private startTimers(): void {
    this.timers.push(
      window.setInterval(() => {
        this.send({ v: 1, t: 'hb', seq: this.hbSeq++, state: this.viewState() });
      }, HEARTBEAT_INTERVAL_MS),
    );
    this.timers.push(
      window.setInterval(() => {
        if (Date.now() - this.lastRx > HEARTBEAT_TIMEOUT_MS) {
          if (this.isPostRelease()) {
            this.wipe('OFFLINE', 'reason.OFFLINE');
          } else if (this.phase === 'waiting' || this.phase === 'connecting') {
            this.stopTimers();
            this.phase = 'dead';
            this.ui.message('lost');
          }
        }
      }, 1000),
    );
    this.timers.push(
      window.setInterval(() => {
        if (this.phase === 'ready' && this.remainingMs !== null) {
          this.remainingMs = Math.max(0, this.remainingMs - 250);
          this.ui.updateLive(this.remainingMs, this.ownerAlive, this.limits.liveTtlMs);
        }
      }, 250),
    );
  }

  private stopTimers(): void {
    for (const id of this.timers) {
      window.clearInterval(id);
    }
    this.timers = [];
    if (this.printTimer !== null) {
      window.clearTimeout(this.printTimer);
      this.printTimer = null;
    }
  }

  private onClosed(): void {
    if (this.phase === 'dead') {
      return;
    }
    if (this.isPostRelease()) {
      this.wipe('OFFLINE', 'reason.OFFLINE');
    } else {
      this.stopTimers();
      this.phase = 'dead';
      this.ui.message('lost');
    }
  }

  private async onMessage(m: RelayToShop): Promise<void> {
    switch (m.t) {
      case 'tick':
        this.ownerAlive = m.ownerAlive;
        if (m.remainingMs !== null && this.phase === 'ready') {
          this.remainingMs = m.remainingMs;
        }
        if (this.phase === 'ready') {
          this.ui.updateLive(this.remainingMs, this.ownerAlive, this.limits.liveTtlMs);
        }
        return;
      case 'denied':
        this.finishDead('reason.DENIED');
        return;
      case 'kill':
        this.wipe('KILLED', reasonKey(m.reason));
        return;
      case 'error':
        if (m.code === 'TOO_MANY_REQUESTS') {
          this.stopTimers();
          this.phase = 'dead';
          this.ui.message('busy');
        } else if (m.code === 'WRONG_STATE' || m.code === 'NOT_FOUND') {
          this.stopTimers();
          this.phase = 'dead';
          this.ui.message('invalid');
        }
        return;
      case 'released':
        if (this.phase === 'waiting') {
          await this.onReleased(m);
        }
        return;
    }
  }

  private finishDead(key: StringKey): void {
    this.stopTimers();
    this.phase = 'dead';
    this.ui.destroyed(key);
    this.ws?.close();
  }

  private async onReleased(m: Extract<RelayToShop, { t: 'released' }>): Promise<void> {
    const link = this.link;
    const kp = this.kp;
    const chan = this.chanKey;
    if (link === null || kp === null || chan === null) {
      return;
    }
    this.phase = 'preparing';
    this.ui.preparing(false);
    const slow = window.setTimeout(() => {
      if (this.phase === 'preparing') {
        this.ui.preparing(true);
      }
    }, SLOW_MS);
    try {
      const sid = base64urlDecode(link.sessionId);
      const fields = {
        sessionId: sid,
        ownerPublicRaw: base64urlDecode(m.ownerPub),
        shopPublicRaw: kp.publicKeyRaw,
        nonce: base64urlDecode(m.nonce),
        wrappedKey: base64urlDecode(m.wrappedKey),
      };
      if (!(await verifyReleaseMac(chan, fields, base64urlDecode(m.mac2)))) {
        throw new Error('mac');
      }
      const key = await unwrapFileKey({
        shopPrivateKey: kp.privateKey,
        shopPublicRaw: kp.publicKeyRaw,
        ownerPublicRaw: fields.ownerPublicRaw,
        sessionId: sid,
        nonce: fields.nonce,
        wrappedKey: fields.wrappedKey,
      });
      const res = await fetch(
        `${this.env.httpBase}/v1/sessions/${link.sessionId}/blob?t=${m.blobToken}`,
        {
          cache: 'no-store',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        },
      );
      if (!res.ok) {
        throw new Error('download');
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      const bundle = await decodeBundle({ key, sessionId: sid, bytes });
      bytes.fill(0);
      if (this.phase !== 'preparing') {
        bundle.pages.forEach((p) => p.fill(0));
        return;
      }
      const pages: PageView[] = [];
      bundle.pages.forEach((bytesOfPage, i) => {
        const info = bundle.manifest.pages[i];
        if (info === undefined) {
          return;
        }
        const copy = new Uint8Array(bytesOfPage);
        const url = URL.createObjectURL(new Blob([copy], { type: info.mime }));
        copy.fill(0);
        bytesOfPage.fill(0); // the Blob holds its own copy
        this.pageUrls.push(url);
        pages.push({ url, width: info.width, height: info.height });
      });
      this.manifest = bundle.manifest;
      this.limits = {
        liveTtlMs: m.limits.liveTtlMs,
        printLimit: m.limits.printLimit,
        destroyAfterPrint: m.limits.destroyAfterPrint,
      };
      this.remainingMs = m.limits.liveTtlMs;
      this.phase = 'ready';
      this.showReady(pages);
      this.ui.buildPrint(pages, bundle.manifest.paper, bundle.manifest.orientation === 'landscape');
      window.addEventListener('beforeprint', this.onBeforePrint);
      window.addEventListener('afterprint', this.onAfterPrint);
      // The browser prints the address of this page in its header, so do not leave the session in it.
      this.hideSessionFromUrl();
      this.send({ v: 1, t: 'rendered', pageCount: pages.length });
    } catch {
      this.wipe('ERROR', 'reason.ERROR');
    } finally {
      window.clearTimeout(slow);
    }
  }

  private hideSessionFromUrl(): void {
    try {
      window.history.replaceState(null, '', '/');
    } catch {
      // not fatal
    }
  }

  private pageViews(): PageView[] {
    const man = this.manifest;
    return this.pageUrls.map((url, i) => ({
      url,
      width: man?.pages[i]?.width ?? 1,
      height: man?.pages[i]?.height ?? 1,
    }));
  }

  private showReady(pages: PageView[]): void {
    this.ui.ready({
      pages,
      remainingMs: this.remainingMs,
      canPrint: this.printsConfirmed < this.limits.printLimit,
      onPrint: () => this.print(),
    });
    this.ui.updateLive(this.remainingMs, this.ownerAlive, this.limits.liveTtlMs);
  }

  /**
   * The printable pages are built as soon as the document is ready, so printing works however it
   * is started: the Print button, Ctrl+P or the browser menu. State changes ride on the browser's
   * beforeprint and afterprint events for the same reason.
   */
  private readonly onBeforePrint = (): void => {
    if (this.phase !== 'ready' && this.phase !== 'confirm') {
      return;
    }
    this.printEvents++;
    this.phase = 'printing';
    if (!this.printStartedSent) {
      this.printStartedSent = true;
      this.send({ v: 1, t: 'printStarted' });
    }
    if (this.printTimer !== null) {
      window.clearTimeout(this.printTimer);
    }
    this.printTimer = window.setTimeout(() => this.toConfirm(), PRINT_FALLBACK_MS);
  };

  private readonly onAfterPrint = (): void => {
    this.toConfirm();
  };

  private print(): void {
    if (this.manifest === null || (this.phase !== 'ready' && this.phase !== 'confirm')) {
      return;
    }
    const before = this.printEvents;
    try {
      window.print();
    } catch {
      // blocked by the browser; the help text explains pop-ups
    }
    if (this.printEvents === before && (this.phase === 'ready' || this.phase === 'confirm')) {
      // A browser that does not fire the print events: carry on as if it had.
      this.onBeforePrint();
      this.onAfterPrint();
    }
  }

  private toConfirm(): void {
    if (this.phase !== 'printing') {
      return;
    }
    if (this.printTimer !== null) {
      window.clearTimeout(this.printTimer);
      this.printTimer = null;
    }
    this.phase = 'confirm';
    this.ui.confirm(
      () => this.printedConfirmed(),
      () => this.print(),
    );
  }

  private printedConfirmed(): void {
    if (this.phase !== 'confirm') {
      return;
    }
    this.send({ v: 1, t: 'printed' });
    this.printsConfirmed++;
    this.printStartedSent = false;
    if (this.limits.destroyAfterPrint && this.printsConfirmed >= this.limits.printLimit) {
      this.phase = 'finishing';
      this.ui.finishing();
    } else {
      this.phase = 'ready';
      this.showReady(this.pageViews());
    }
  }

  /**
   * Wipe procedure (ARCHITECTURE.md section 7.1). Order matters: remove everything that can show
   * the document first, then release memory, then tell the relay.
   */
  private wipe(reason: ShopWipeReason, key: StringKey): void {
    if (this.phase === 'dead') {
      return;
    }
    this.phase = 'dead';
    this.stopTimers();
    window.removeEventListener('beforeprint', this.onBeforePrint);
    window.removeEventListener('afterprint', this.onAfterPrint);
    this.ui.purge();
    for (const url of this.pageUrls) {
      URL.revokeObjectURL(url);
    }
    this.pageUrls = [];
    this.manifest = null;
    this.kp = null;
    this.chanKey = null;
    this.remainingMs = null;
    this.hideSessionFromUrl();
    this.ui.destroyed(key);
    this.send({ v: 1, t: 'wiped', reason });
    const ws = this.ws;
    this.ws = null;
    window.setTimeout(() => ws?.close(), 200);
  }
}
