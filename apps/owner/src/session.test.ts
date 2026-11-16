import { decodeBundle } from '@despawn/bundle';
import {
  base64urlDecode,
  base64urlEncode,
  computeHelloMac,
  computeSas,
  deriveChannelKey,
  generateEcdhKeyPair,
  unwrapFileKey,
  verifyReleaseMac,
} from '@despawn/crypto';
import { startServer, type RunningServer } from '@despawn/adapter-node';
import { afterEach, describe, expect, it } from 'vitest';
import { OwnerSession, type LiveState } from './session.js';

const MARKER = 'OWNER-TEST-MARKER-ABCDEFGHIJKLMNOP';
const RULES = {
  linkTtlMs: 1_800_000,
  liveTtlMs: 60_000,
  printLimit: 1,
  destroyAfterPrint: true,
  graceMs: 500,
};
let srv: RunningServer;
let sessions: OwnerSession[] = [];
afterEach(async () => {
  sessions.forEach((s) => s.dispose());
  sessions = [];
  await srv?.close();
});

function pageBytes(): Uint8Array {
  const b = new Uint8Array(5000).map((_, i) => (i * 13) & 0xff);
  b.set(new TextEncoder().encode(MARKER), 200);
  return b;
}
const manifest = {
  v: 1 as const,
  paper: 'A4' as const,
  orientation: 'portrait' as const,
  dpi: 200,
  purposeLabel: 'T',
  watermark: 'w',
  pages: [{ width: 10, height: 10, mime: 'image/png' as const, byteLength: 5000 }],
};

async function until<T>(fn: () => T | undefined | false, ms = 4000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

class FakeShop {
  ws!: WebSocket;
  msgs: Array<Record<string, unknown>> = [];
  kp!: Awaited<ReturnType<typeof generateEcdhKeyPair>>;
  sas = '';
  async open(link: string, mac?: Uint8Array): Promise<void> {
    const u = new URL(link);
    const id = u.pathname.split('/')[2]!;
    const sid = base64urlDecode(id);
    const secret = base64urlDecode(u.hash.slice(1));
    this.kp = await generateEcdhKeyPair();
    const chan = await deriveChannelKey(secret, sid);
    this.sas = await computeSas(sid, this.kp.publicKeyRaw);
    this.ws = new WebSocket(`${u.origin.replace('http', 'ws')}/v1/sessions/${id}/shop`, [
      'despawn.v1',
    ]);
    this.ws.addEventListener('message', (e) =>
      this.msgs.push(JSON.parse(String(e.data)) as Record<string, unknown>),
    );
    await new Promise<void>((r) => this.ws.addEventListener('open', () => r()));
    this.send({
      t: 'hello',
      shopPub: base64urlEncode(this.kp.publicKeyRaw),
      mac: base64urlEncode(mac ?? (await computeHelloMac(chan, sid, this.kp.publicKeyRaw))),
      ua: { browser: 'Chrome 109', os: 'Windows 7' },
    });
  }
  send(m: Record<string, unknown>): void {
    this.ws.send(JSON.stringify({ v: 1, ...m }));
  }
  find(t: string): Record<string, unknown> | undefined {
    return this.msgs.find((m) => m.t === t);
  }
}

function make(): { s: OwnerSession; states: LiveState[] } {
  const states: LiveState[] = [];
  const s = new OwnerSession(srv.url, (x) => states.push(x));
  sessions.push(s);
  return { s, states };
}

describe('OwnerSession against the real relay', () => {
  it('creates, uploads, verifies the shop, approves, and ends with a receipt', async () => {
    srv = await startServer();
    const { s } = make();
    await s.start({ pages: [pageBytes()], manifest, rules: RULES });
    await until(() => s.current.phase === 'armed' && s.current.online);
    expect((await srv.inspect()).blobs).toBe(1);

    const shop = new FakeShop();
    await shop.open(s.current.link!);
    const req = await until(() => s.current.requests[0]);
    expect(req.sas).toBe(shop.sas);
    expect(req.browser).toBe('Chrome 109');

    expect(await s.approve(req.reqId)).toBe(true);
    const rel = await until(() => shop.find('released'));
    const u = new URL(s.current.link!);
    const sid = base64urlDecode(u.pathname.split('/')[2]!);
    const chan = await deriveChannelKey(base64urlDecode(u.hash.slice(1)), sid);
    const fields = {
      sessionId: sid,
      ownerPublicRaw: base64urlDecode(rel.ownerPub as string),
      shopPublicRaw: shop.kp.publicKeyRaw,
      nonce: base64urlDecode(rel.nonce as string),
      wrappedKey: base64urlDecode(rel.wrappedKey as string),
    };
    expect(await verifyReleaseMac(chan, fields, base64urlDecode(rel.mac2 as string))).toBe(true);
    const key = await unwrapFileKey({
      shopPrivateKey: shop.kp.privateKey,
      shopPublicRaw: shop.kp.publicKeyRaw,
      ownerPublicRaw: fields.ownerPublicRaw,
      sessionId: sid,
      nonce: fields.nonce,
      wrappedKey: fields.wrappedKey,
    });
    const blob = await fetch(
      `${srv.url}/v1/sessions/${u.pathname.split('/')[2]}/blob?t=${String(rel.blobToken)}`,
    );
    const out = await decodeBundle({
      key,
      sessionId: sid,
      bytes: new Uint8Array(await blob.arrayBuffer()),
    });
    expect(new TextDecoder().decode(out.pages[0]!.subarray(200, 200 + MARKER.length))).toBe(MARKER);

    shop.send({ t: 'rendered', pageCount: 1 });
    await until(() => s.current.phase === 'live' && s.current.sessionState === 'LIVE');
    shop.send({ t: 'printStarted' });
    shop.send({ t: 'printed' });
    await until(() => shop.find('kill'));
    shop.send({ t: 'wiped', reason: 'PRINTED' });
    const d = await until(() => s.current.destroyed);
    expect(d).toMatchObject({ reason: 'PRINTED', printsDone: 1, shopReportedWipe: true });
    expect(s.current.phase).toBe('ended');
    expect((await srv.inspect()).blobs).toBe(0);
  });

  it('never shows a request that was not made with the link secret', async () => {
    srv = await startServer();
    const { s } = make();
    await s.start({ pages: [pageBytes()], manifest, rules: RULES });
    await until(() => s.current.phase === 'armed' && s.current.online);
    const shop = new FakeShop();
    await shop.open(s.current.link!, new Uint8Array(32)); // wrong MAC
    await until(() => shop.find('denied'));
    expect(s.current.requests).toHaveLength(0);
  });

  it('shows two requests with different codes and releases only the approved one', async () => {
    srv = await startServer();
    const { s } = make();
    await s.start({ pages: [pageBytes()], manifest, rules: RULES });
    await until(() => s.current.phase === 'armed' && s.current.online);
    const a = new FakeShop();
    const b = new FakeShop();
    await a.open(s.current.link!);
    await b.open(s.current.link!);
    await until(() => s.current.requests.length === 2);
    const codes = s.current.requests.map((r) => r.sas);
    expect(new Set(codes).size).toBe(2);
    const second = s.current.requests.find((r) => r.sas === b.sas)!;
    await s.approve(second.reqId);
    await until(() => b.find('released'));
    await until(() => a.find('denied'));
    expect(a.find('released')).toBeUndefined();
  });

  it('removes a request when that shop goes away', async () => {
    srv = await startServer();
    const { s } = make();
    await s.start({ pages: [pageBytes()], manifest, rules: RULES });
    await until(() => s.current.phase === 'armed' && s.current.online);
    const shop = new FakeShop();
    await shop.open(s.current.link!);
    await until(() => s.current.requests.length === 1);
    shop.ws.close();
    await until(() => s.current.requests.length === 0);
  });

  it('kill destroys everything and reports no wipe confirmation when the shop is silent', async () => {
    srv = await startServer();
    const { s } = make();
    await s.start({ pages: [pageBytes()], manifest, rules: RULES });
    await until(() => s.current.phase === 'armed' && s.current.online);
    const shop = new FakeShop();
    await shop.open(s.current.link!);
    const req = await until(() => s.current.requests[0]);
    await s.approve(req.reqId);
    await until(() => shop.find('released'));
    shop.send({ t: 'rendered', pageCount: 1 });
    await until(() => s.current.sessionState === 'LIVE');
    await s.kill();
    expect(await until(() => s.current.destroyed, 6000)).toMatchObject({
      reason: 'OWNER_KILLED',
      shopReportedWipe: false,
    });
    expect((await srv.inspect()).blobs).toBe(0);
  });

  it('reports a too-large payload without contacting the server', async () => {
    srv = await startServer();
    const { s } = make();
    await s.start({
      pages: [new Uint8Array(26 * 1024 * 1024)],
      manifest: { ...manifest, pages: [{ ...manifest.pages[0]!, byteLength: 26 * 1024 * 1024 }] },
      rules: RULES,
    });
    expect(s.current).toMatchObject({ phase: 'error', error: 'TOO_LARGE' });
    expect(srv.relay.stats().sessions).toBe(0);
  });

  it('zeroes the page bytes it was given', async () => {
    srv = await startServer();
    const { s } = make();
    const page = pageBytes();
    await s.start({ pages: [page], manifest, rules: RULES });
    expect(page.every((b) => b === 0)).toBe(true);
  });
});
