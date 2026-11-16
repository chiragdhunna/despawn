import { decodeBundle, encodeBundle, type Manifest } from '@despawn/bundle';
import {
  base64urlDecode,
  base64urlEncode,
  computeHelloMac,
  computeReleaseMac,
  computeSas,
  deriveChannelKey,
  generateEcdhKeyPair,
  generateFileKeyBytes,
  generateLinkSecret,
  generateNoncePrefix,
  importFileKey,
  unwrapFileKey,
  verifyHelloMac,
  verifyReleaseMac,
  wrapFileKey,
} from '@despawn/crypto';
import { HEARTBEAT_TIMEOUT_MS, MAX_FRAME_BYTES, BLOB_TOKEN_TTL_MS } from '@despawn/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  FakeSocket,
  ManualScheduler,
  MemoryBlobStore,
  Relay,
  type SocketHandler,
} from './index.js';

const MARKER = 'PLAINTEXT-MARKER-0123456789-ABCDEFGHIJ';
const RULES = {
  linkTtlMs: 1_800_000,
  liveTtlMs: 120_000,
  printLimit: 1,
  destroyAfterPrint: true,
  graceMs: 10_000,
};

let sched: ManualScheduler;
let blobs: MemoryBlobStore;
let relay: Relay;

beforeEach(() => {
  sched = new ManualScheduler();
  blobs = new MemoryBlobStore();
  relay = new Relay({ blobs, scheduler: sched });
});

function pageBytes(): Uint8Array {
  const b = new Uint8Array(4000);
  for (let i = 0; i < b.length; i++) b[i] = (i * 7) & 0xff;
  b.set(new TextEncoder().encode(MARKER), 100);
  return b;
}

class Owner {
  readonly sock = new FakeSocket();
  handler: SocketHandler | null = null;
  id = '';
  token = '';
  sessionIdBytes: Uint8Array = new Uint8Array();
  readonly linkSecret = generateLinkSecret();
  readonly fileKeyRaw = generateFileKeyBytes();
  readonly page = pageBytes();

  static async create(rules: Record<string, unknown> = RULES, putBlob = true): Promise<Owner> {
    const o = new Owner();
    const res = await relay.createSession({
      ...rules,
      blobBytes: 4400,
      verifyEnabled: false,
    });
    if (res.status !== 201) throw new Error(`create failed ${res.status}`);
    const json = res.json as { sessionId: string; ownerToken: string };
    o.id = json.sessionId;
    o.token = json.ownerToken;
    o.sessionIdBytes = base64urlDecode(o.id);
    if (putBlob) {
      const manifest: Manifest = {
        v: 1,
        paper: 'A4',
        orientation: 'portrait',
        dpi: 200,
        purposeLabel: 'Test',
        watermark: 'wm',
        pages: [{ width: 100, height: 100, mime: 'image/jpeg', byteLength: o.page.length }],
      };
      const packed = await encodeBundle({
        key: await importFileKey(o.fileKeyRaw, 'encrypt'),
        sessionId: o.sessionIdBytes,
        noncePrefix: generateNoncePrefix(),
        manifest,
        pages: [o.page],
      });
      const put = await relay.putBlob(o.id, o.token, packed);
      expect(put.status).toBe(204);
    }
    o.attach();
    return o;
  }

  attach(): void {
    this.handler = relay.attachOwner(this.id, this.token, this.sock);
    expect(this.handler).not.toBeNull();
  }

  send(msg: Record<string, unknown>): void {
    this.handler?.onMessage(JSON.stringify({ v: 1, ...msg }));
  }

  requests(): Array<Record<string, unknown>> {
    return this.sock.frames().filter((f) => f.t === 'request');
  }

  /** Verifies the shop's hello like the real owner app, returns the SAS shown on the phone. */
  async check(req: Record<string, unknown>): Promise<{ ok: boolean; sas: string }> {
    const chan = await deriveChannelKey(this.linkSecret, this.sessionIdBytes);
    const shopPub = base64urlDecode(req.shopPub as string);
    const ok = await verifyHelloMac(
      chan,
      this.sessionIdBytes,
      shopPub,
      base64urlDecode(req.mac as string),
    );
    return { ok, sas: await computeSas(this.sessionIdBytes, shopPub) };
  }

  async approve(req: Record<string, unknown>): Promise<void> {
    const chan = await deriveChannelKey(this.linkSecret, this.sessionIdBytes);
    const kp = await generateEcdhKeyPair();
    const shopPub = base64urlDecode(req.shopPub as string);
    const w = await wrapFileKey({
      ownerPrivateKey: kp.privateKey,
      ownerPublicRaw: kp.publicKeyRaw,
      shopPublicRaw: shopPub,
      sessionId: this.sessionIdBytes,
      fileKey: this.fileKeyRaw,
    });
    const mac2 = await computeReleaseMac(chan, {
      sessionId: this.sessionIdBytes,
      ownerPublicRaw: kp.publicKeyRaw,
      shopPublicRaw: shopPub,
      nonce: w.nonce,
      wrappedKey: w.wrappedKey,
    });
    this.send({
      t: 'approve',
      reqId: req.reqId,
      ownerPub: base64urlEncode(kp.publicKeyRaw),
      nonce: base64urlEncode(w.nonce),
      wrappedKey: base64urlEncode(w.wrappedKey),
      mac2: base64urlEncode(mac2),
    });
  }
}

class Shop {
  readonly sock = new FakeSocket();
  handler: SocketHandler | null = null;
  kp!: Awaited<ReturnType<typeof generateEcdhKeyPair>>;
  sas = '';

  static async open(o: Owner): Promise<Shop> {
    const s = new Shop();
    s.handler = relay.attachShop(o.id, s.sock, {});
    expect(s.handler).not.toBeNull();
    s.kp = await generateEcdhKeyPair();
    const chan = await deriveChannelKey(o.linkSecret, o.sessionIdBytes);
    const mac = await computeHelloMac(chan, o.sessionIdBytes, s.kp.publicKeyRaw);
    s.sas = await computeSas(o.sessionIdBytes, s.kp.publicKeyRaw);
    s.send({
      t: 'hello',
      shopPub: base64urlEncode(s.kp.publicKeyRaw),
      mac: base64urlEncode(mac),
      ua: { browser: 'Chrome 109', os: 'Windows 7' },
    });
    return s;
  }

  send(msg: Record<string, unknown>): void {
    this.handler?.onMessage(JSON.stringify({ v: 1, ...msg }));
  }

  /** Verifies the release like the real viewer and returns the decoded plaintext page. */
  async receive(o: Owner): Promise<Uint8Array> {
    const rel = this.sock.last('released');
    expect(rel).toBeDefined();
    const chan = await deriveChannelKey(o.linkSecret, o.sessionIdBytes);
    const fields = {
      sessionId: o.sessionIdBytes,
      ownerPublicRaw: base64urlDecode(rel!.ownerPub as string),
      shopPublicRaw: this.kp.publicKeyRaw,
      nonce: base64urlDecode(rel!.nonce as string),
      wrappedKey: base64urlDecode(rel!.wrappedKey as string),
    };
    expect(await verifyReleaseMac(chan, fields, base64urlDecode(rel!.mac2 as string))).toBe(true);
    const key = await unwrapFileKey({
      shopPrivateKey: this.kp.privateKey,
      shopPublicRaw: this.kp.publicKeyRaw,
      ownerPublicRaw: fields.ownerPublicRaw,
      sessionId: o.sessionIdBytes,
      nonce: fields.nonce,
      wrappedKey: fields.wrappedKey,
    });
    const blob = await relay.getBlob(o.id, rel!.blobToken as string);
    expect(blob.status).toBe(200);
    const out = await decodeBundle({ key, sessionId: o.sessionIdBytes, bytes: blob.body! });
    return out.pages[0]!;
  }
}

/** Advances time in 2 s steps, sending heartbeats from whichever sides are given. */
async function beat(ms: number, o: Owner | null, s: Shop | null): Promise<void> {
  for (let t = 0; t < ms; t += 2000) {
    o?.send({ t: 'hb', seq: t });
    s?.send({ t: 'hb', seq: t, state: 'READY' });
    await sched.advance(2000);
  }
}

async function toLive(o: Owner): Promise<Shop> {
  const s = await Shop.open(o);
  await o.approve(o.requests()[0]!);
  await s.receive(o);
  s.send({ t: 'rendered', pageCount: 1 });
  return s;
}

describe('happy path', () => {
  it('runs the complete session end to end and leaves nothing behind', async () => {
    const o = await Owner.create();
    expect(blobs.map.size).toBe(1);
    const s = await Shop.open(o);

    const req = o.requests()[0]!;
    const seen = await o.check(req);
    expect(seen.ok).toBe(true);
    expect(seen.sas).toBe(s.sas);
    expect(o.sock.last('status')?.state).toBe('AWAITING');

    await o.approve(req);
    const page = await s.receive(o);
    expect(new TextDecoder().decode(page.subarray(100, 100 + MARKER.length))).toBe(MARKER);

    s.send({ t: 'rendered', pageCount: 1 });
    expect(o.sock.last('status')?.state).toBe('LIVE');
    s.send({ t: 'printStarted' });
    s.send({ t: 'printed' });
    expect(o.sock.last('status')?.printsDone).toBe(1);

    await beat(10_000, o, s);
    expect(s.sock.last('kill')?.reason).toBe('PRINTED');
    s.send({ t: 'wiped', reason: 'PRINTED' });
    const d = o.sock.last('destroyed')!;
    expect(d.reason).toBe('PRINTED');
    expect(d.shopReportedWipe).toBe(true);
    expect(blobs.map.size).toBe(0);
    await sched.advance(5000);
    expect(relay.stats().sessions).toBe(0);
  });

  it('never stores or relays plaintext', async () => {
    const o = await Owner.create();
    const s = await toLive(o);
    const everything = [
      ...[...blobs.map.values()].map((b) => new TextDecoder('latin1').decode(b)),
      ...o.sock.sent,
      ...s.sock.sent,
    ].join('\n');
    expect(everything.includes(MARKER)).toBe(false);
  });
});

describe('what the shop cannot do', () => {
  it('cannot get ciphertext without a valid release token', async () => {
    const o = await Owner.create();
    const s = await Shop.open(o);
    expect((await relay.getBlob(o.id, 'x'.repeat(43))).status).toBe(404);
    expect((await relay.getBlob(o.id, base64urlEncode(new Uint8Array(32)))).status).toBe(404);
    expect(s.sock.last('released')).toBeUndefined();
    expect(blobs.map.size).toBe(1);
  });

  it('token is one time and expires', async () => {
    const o = await Owner.create();
    const s = await Shop.open(o);
    await o.approve(o.requests()[0]!);
    const token = s.sock.last('released')!.blobToken as string;
    expect((await relay.getBlob(o.id, token)).status).toBe(200);
    expect((await relay.getBlob(o.id, token)).status).toBe(404);

    const o2 = await Owner.create();
    const s2 = await Shop.open(o2);
    await o2.approve(o2.requests()[0]!);
    const t2 = s2.sock.last('released')!.blobToken as string;
    await sched.advance(BLOB_TOKEN_TTL_MS + 1);
    expect((await relay.getBlob(o2.id, t2)).status).toBe(404);
  });

  it('two shops: separate requests and codes, only the approved one is released', async () => {
    const o = await Owner.create();
    const a = await Shop.open(o);
    const b = await Shop.open(o);
    const reqs = o.requests();
    expect(reqs).toHaveLength(2);
    expect(a.sas).not.toBe(b.sas);
    await o.approve(reqs[1]!);
    expect(b.sock.last('released')).toBeDefined();
    expect(a.sock.last('released')).toBeUndefined();
    expect(a.sock.last('denied')).toBeDefined();
    await b.receive(o);
  });

  it('a link is single use after release', async () => {
    const o = await Owner.create();
    await toLive(o);
    const late = await Shop.open(o);
    expect(late.sock.last('error')?.code).toBe('WRONG_STATE');
    expect(late.sock.isOpen).toBe(false);
  });

  it('messages from a shop that was not approved are ignored', async () => {
    const o = await Owner.create();
    const a = await Shop.open(o);
    const b = await Shop.open(o);
    await o.approve(o.requests()[0]!);
    b.send({ t: 'rendered', pageCount: 1 });
    b.send({ t: 'wiped', reason: 'ERROR' });
    expect(o.sock.last('status')?.state).toBe('RELEASED');
    await a.receive(o);
  });

  it('a second hello on the same connection is dropped', async () => {
    const o = await Owner.create();
    const s = await Shop.open(o);
    s.send({
      t: 'hello',
      shopPub: o.requests()[0]!.shopPub,
      mac: o.requests()[0]!.mac,
      ua: { browser: 'x', os: 'y' },
    });
    expect(o.requests()).toHaveLength(1);
  });

  it('rejects bad frames, closes after repeated abuse, and enforces the frame limit', async () => {
    const o = await Owner.create();
    const sock = new FakeSocket();
    const h = relay.attachShop(o.id, sock, {})!;
    h.onMessage('not json');
    expect(sock.last('error')?.code).toBe('BAD_MESSAGE');
    h.onMessage('x'.repeat(MAX_FRAME_BYTES + 1));
    expect(sock.frames().map((f) => f.code)).toContain('TOO_LARGE');
    h.onMessage('{}');
    expect(sock.isOpen).toBe(false);
  });
});

describe('what the owner controls', () => {
  it('only the owner token can upload, delete or attach', async () => {
    const o = await Owner.create({ ...RULES }, false);
    expect(
      (await relay.putBlob(o.id, base64urlEncode(new Uint8Array(32)), new Uint8Array(10))).status,
    ).toBe(403);
    expect(relay.deleteSession(o.id, base64urlEncode(new Uint8Array(32))).status).toBe(403);
    expect(relay.attachOwner(o.id, 'AAAA', new FakeSocket())).toBeNull();
    expect((await relay.putBlob('nope', o.token, new Uint8Array(10))).status).toBe(404);
    expect(relay.deleteSession(o.id, o.token).status).toBe(204);
  });

  it('upload is limited to once, to the declared size, and to the CREATED state', async () => {
    const o = await Owner.create({ ...RULES }, false);
    expect((await relay.putBlob(o.id, o.token, new Uint8Array(0))).status).toBe(413);
    expect((await relay.putBlob(o.id, o.token, new Uint8Array(5000))).status).toBe(413);
    expect((await relay.putBlob(o.id, o.token, new Uint8Array(100))).status).toBe(204);
    expect((await relay.putBlob(o.id, o.token, new Uint8Array(100))).status).toBe(409);
  });

  it('kill during LIVE wipes everything and reports whether the shop confirmed', async () => {
    const o = await Owner.create();
    const s = await toLive(o);
    o.send({ t: 'kill' });
    expect(s.sock.last('kill')?.reason).toBe('OWNER_KILLED');
    expect(blobs.map.size).toBe(0);
    expect(o.sock.last('destroyed')).toBeUndefined(); // waits briefly for the shop's wipe report
    s.send({ t: 'wiped', reason: 'KILLED' });
    expect(o.sock.last('destroyed')).toMatchObject({
      reason: 'OWNER_KILLED',
      shopReportedWipe: true,
    });
  });

  it('reports shopReportedWipe false when the shop never confirms', async () => {
    const o = await Owner.create();
    await toLive(o);
    o.send({ t: 'kill' });
    await sched.advance(3000);
    expect(o.sock.last('destroyed')).toMatchObject({
      reason: 'OWNER_KILLED',
      shopReportedWipe: false,
    });
  });

  it('cancel before anyone opens the link deletes the ciphertext', async () => {
    const o = await Owner.create();
    expect(relay.deleteSession(o.id, o.token).status).toBe(204);
    expect(blobs.map.size).toBe(0);
    expect(o.sock.last('destroyed')?.reason).toBe('CANCELLED');
  });

  it('shows requests again after the owner reconnects', async () => {
    const o = await Owner.create();
    await Shop.open(o);
    const again = new FakeSocket();
    relay.attachOwner(o.id, o.token, again);
    expect(again.last('status')?.pending).toBe(1);
    expect(again.last('request')).toBeDefined();
  });

  it('tells the owner when a pending shop disappears', async () => {
    const o = await Owner.create();
    const s = await Shop.open(o);
    s.handler!.onClose();
    expect(o.sock.last('requestGone')?.reqId).toBe(o.requests()[0]!.reqId);
    expect(o.sock.last('status')?.state).toBe('ARMED');
  });

  it('denying sends denied to that shop', async () => {
    const o = await Owner.create();
    const s = await Shop.open(o);
    o.send({ t: 'deny', reqId: o.requests()[0]!.reqId });
    expect(s.sock.last('denied')).toBeDefined();
    expect(o.sock.last('status')?.state).toBe('ARMED');
  });
});

describe('fail closed', () => {
  it('aborts when the shop stops sending heartbeats', async () => {
    const o = await Owner.create();
    const s = await toLive(o);
    await beat(4000, o, s);
    await beat(HEARTBEAT_TIMEOUT_MS + 2000, o, null);
    expect(o.sock.last('destroyed')?.reason).toBe('HEARTBEAT_LOST');
    expect(s.sock.last('kill')?.reason).toBe('HEARTBEAT_LOST');
    expect(blobs.map.size).toBe(0);
  });

  it('aborts when the owner stops sending heartbeats and tells the shop the owner is gone', async () => {
    const o = await Owner.create();
    const s = await toLive(o);
    await beat(4000, o, s);
    await beat(6000, null, s);
    expect(s.sock.last('tick')?.ownerAlive).toBe(false);
    await beat(6000, null, s);
    expect(s.sock.last('kill')?.reason).toBe('HEARTBEAT_LOST');
  });

  it('aborts when the shop connection closes after release', async () => {
    const o = await Owner.create();
    const s = await toLive(o);
    s.sock.close();
    s.handler!.onClose();
    expect(o.sock.last('destroyed')?.reason).toBe('HEARTBEAT_LOST');
  });

  it('aborts when the shop never reports rendered', async () => {
    const o = await Owner.create();
    const s = await Shop.open(o);
    await o.approve(o.requests()[0]!);
    await beat(70_000, o, s);
    expect(o.sock.last('destroyed')?.reason).toBe('RELEASE_TIMEOUT');
  });

  it('ends the live window on time', async () => {
    const o = await Owner.create();
    const s = await toLive(o);
    await beat(122_000, o, s);
    expect(s.sock.last('kill')?.reason).toBe('LIVE_TIMEOUT');
    expect(blobs.map.size).toBe(0);
  });

  it('expires an unopened link and removes the ciphertext', async () => {
    const o = await Owner.create();
    await sched.advance(RULES.linkTtlMs + 1);
    expect(o.sock.last('destroyed')?.reason).toBe('LINK_EXPIRED');
    expect(blobs.map.size).toBe(0);
    await sched.advance(4000);
    expect(relay.attachShop(o.id, new FakeSocket(), {})).toBeNull();
  });

  it('expires a session whose ciphertext was never uploaded', async () => {
    const o = await Owner.create({ ...RULES }, false);
    await sched.advance(600_001);
    expect(o.sock.last('destroyed')?.reason).toBe('LINK_EXPIRED');
  });

  it('shutdown terminates every session', async () => {
    const o = await Owner.create();
    await toLive(o);
    relay.shutdown();
    expect(blobs.map.size).toBe(0);
    await sched.advance(3000);
    expect(o.sock.last('destroyed')?.reason).toBe('OWNER_KILLED');
  });
});

describe('connection limits', () => {
  it('caps shop connections per session', async () => {
    const o = await Owner.create();
    const accepted: Array<SocketHandler | null> = [];
    for (let i = 0; i < 20; i++) accepted.push(relay.attachShop(o.id, new FakeSocket(), {}));
    expect(accepted.filter((h) => h !== null)).toHaveLength(12);
  });

  it('closes a connection that never says hello', async () => {
    const o = await Owner.create();
    const sock = new FakeSocket();
    relay.attachShop(o.id, sock, {});
    await sched.advance(9_000);
    expect(sock.isOpen).toBe(true);
    await sched.advance(2_000);
    expect(sock.isOpen).toBe(false);
  });

  it('keeps a connection that did say hello', async () => {
    const o = await Owner.create();
    const s = await Shop.open(o);
    await sched.advance(11_000);
    expect(s.sock.isOpen).toBe(true);
  });
});

describe('abuse controls', () => {
  it('rejects malformed create requests and oversized blobs', async () => {
    expect((await relay.createSession({})).status).toBe(400);
    expect(
      (await relay.createSession({ ...RULES, blobBytes: 999_999_999, verifyEnabled: false }))
        .status,
    ).toBe(400);
    const small = new Relay({ blobs, scheduler: sched, config: { maxBlobBytes: 1000 } });
    expect(
      (await small.createSession({ ...RULES, blobBytes: 2000, verifyEnabled: false })).status,
    ).toBe(413);
    expect(
      (await relay.createSession({ ...RULES, liveTtlMs: 1, blobBytes: 10, verifyEnabled: false }))
        .status,
    ).toBe(400);
  });

  it('enforces the daily and active caps and the challenge hook', async () => {
    const r1 = new Relay({ blobs, scheduler: sched, config: { maxSessionsPerDay: 2 } });
    const body = { ...RULES, blobBytes: 10, verifyEnabled: false };
    expect((await r1.createSession(body)).status).toBe(201);
    expect((await r1.createSession(body)).status).toBe(201);
    expect((await r1.createSession(body)).status).toBe(429);
    const r2 = new Relay({ blobs, scheduler: sched, config: { maxActiveSessions: 1 } });
    expect((await r2.createSession(body)).status).toBe(201);
    expect((await r2.createSession(body)).status).toBe(503);
    const r3 = new Relay({
      blobs,
      scheduler: sched,
      config: { verifyChallenge: (t) => Promise.resolve(t === 'good') },
    });
    expect((await r3.createSession(body)).status).toBe(403);
    expect((await r3.createSession({ ...body, challengeToken: 'good' })).status).toBe(201);
  });
});
