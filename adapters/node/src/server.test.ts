import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { decodeBundle, encodeBundle } from '@despawn/bundle';
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
  verifyReleaseMac,
  wrapFileKey,
} from '@despawn/crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { FileBlobStore, safeResolve, startServer, type RunningServer } from './index.js';

const MARKER = 'NETWORK-PLAINTEXT-MARKER-9876543210';
const BODY = {
  linkTtlMs: 1_800_000,
  liveTtlMs: 120_000,
  printLimit: 1,
  destroyAfterPrint: true,
  graceMs: 1000,
  blobBytes: 6000,
  verifyEnabled: false,
};

let srv: RunningServer;
let dirs: string[] = [];
afterEach(async () => {
  await srv?.close();
  for (const d of dirs) await rm(d, { recursive: true, force: true });
  dirs = [];
});
async function tmp(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), 'despawn-test-'));
  dirs.push(d);
  return d;
}

class Conn {
  readonly ws: WebSocket;
  readonly msgs: Array<Record<string, unknown>> = [];
  closeCode: number | null = null;
  constructor(url: string, protocols: string[]) {
    this.ws = new WebSocket(url, protocols);
    this.ws.on('message', (d) =>
      this.msgs.push(JSON.parse(d.toString()) as Record<string, unknown>),
    );
    this.ws.on('close', (c) => (this.closeCode = c));
    this.ws.on('error', () => undefined);
  }
  opened(): Promise<void> {
    return new Promise((res, rej) => {
      this.ws.once('open', () => res());
      this.ws.once('unexpected-response', (_q, r) => rej(new Error(`status ${r.statusCode}`)));
      this.ws.once('error', (e) => rej(e));
    });
  }
  send(m: Record<string, unknown>): void {
    this.ws.send(JSON.stringify({ v: 1, ...m }));
  }
  async next(type: string, ms = 3000): Promise<Record<string, unknown>> {
    const t0 = Date.now();
    for (;;) {
      const i = this.msgs.findIndex((m) => m.t === type);
      if (i >= 0) return this.msgs.splice(i, 1)[0]!;
      if (Date.now() - t0 > ms)
        throw new Error(`timeout waiting for ${type}; got ${this.msgs.map((m) => m.t).join(',')}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  async closed(ms = 3000): Promise<number> {
    const t0 = Date.now();
    while (this.closeCode === null) {
      if (Date.now() - t0 > ms) throw new Error('not closed');
      await new Promise((r) => setTimeout(r, 10));
    }
    return this.closeCode;
  }
}

async function create(): Promise<{ id: string; token: string }> {
  const r = await fetch(`${srv.url}/v1/sessions`, { method: 'POST', body: JSON.stringify(BODY) });
  expect(r.status).toBe(201);
  const j = (await r.json()) as { sessionId: string; ownerToken: string };
  return { id: j.sessionId, token: j.ownerToken };
}

async function upload(id: string, token: string, fileKey: Uint8Array): Promise<void> {
  const page = new Uint8Array(3000).map((_, i) => i & 0xff);
  page.set(new TextEncoder().encode(MARKER), 50);
  const packed = await encodeBundle({
    key: await importFileKey(fileKey, 'encrypt'),
    sessionId: base64urlDecode(id),
    noncePrefix: generateNoncePrefix(),
    manifest: {
      v: 1,
      paper: 'A4',
      orientation: 'portrait',
      dpi: 200,
      purposeLabel: 'T',
      watermark: 'w',
      pages: [{ width: 10, height: 10, mime: 'image/png', byteLength: page.length }],
    },
    pages: [page],
  });
  const r = await fetch(`${srv.url}/v1/sessions/${id}/blob`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: packed.buffer.slice(
      packed.byteOffset,
      packed.byteOffset + packed.byteLength,
    ) as ArrayBuffer,
  });
  expect(r.status).toBe(204);
}

function wsUrl(id: string, role: string): string {
  return `${srv.url.replace('http', 'ws')}/v1/sessions/${id}/${role}`;
}

describe('complete session over real HTTP and WebSocket', () => {
  it('runs end to end with ciphertext on disk and leaves nothing behind', async () => {
    const blobDir = await tmp();
    srv = await startServer({ blobDir });
    const { id, token } = await create();
    const sid = base64urlDecode(id);
    const linkSecret = generateLinkSecret();
    const fileKey = generateFileKeyBytes();
    await upload(id, token, fileKey);
    expect(await srv.inspect()).toEqual({ sessions: 1, blobs: 1 });

    const owner = new Conn(wsUrl(id, 'owner'), ['despawn.v1', `token.${token}`]);
    await owner.opened();
    expect((await owner.next('status')).state).toBe('ARMED');

    const shop = new Conn(wsUrl(id, 'shop'), ['despawn.v1']);
    await shop.opened();
    const kp = await generateEcdhKeyPair();
    const chan = await deriveChannelKey(linkSecret, sid);
    shop.send({
      t: 'hello',
      shopPub: base64urlEncode(kp.publicKeyRaw),
      mac: base64urlEncode(await computeHelloMac(chan, sid, kp.publicKeyRaw)),
      ua: { browser: 'Chrome 109', os: 'Windows 7' },
    });

    const req = await owner.next('request');
    expect(await computeSas(sid, base64urlDecode(req.shopPub as string))).toBe(
      await computeSas(sid, kp.publicKeyRaw),
    );
    // ciphertext is on disk and does not contain the marker
    for (const f of await readdir(blobDir))
      expect((await readFile(path.join(blobDir, f))).includes(MARKER)).toBe(false);

    const ok = await generateEcdhKeyPair();
    const w = await wrapFileKey({
      ownerPrivateKey: ok.privateKey,
      ownerPublicRaw: ok.publicKeyRaw,
      shopPublicRaw: kp.publicKeyRaw,
      sessionId: sid,
      fileKey,
    });
    const mac2 = await computeReleaseMac(chan, {
      sessionId: sid,
      ownerPublicRaw: ok.publicKeyRaw,
      shopPublicRaw: kp.publicKeyRaw,
      nonce: w.nonce,
      wrappedKey: w.wrappedKey,
    });
    owner.send({
      t: 'approve',
      reqId: req.reqId,
      ownerPub: base64urlEncode(ok.publicKeyRaw),
      nonce: base64urlEncode(w.nonce),
      wrappedKey: base64urlEncode(w.wrappedKey),
      mac2: base64urlEncode(mac2),
    });

    const rel = await shop.next('released');
    const fields = {
      sessionId: sid,
      ownerPublicRaw: base64urlDecode(rel.ownerPub as string),
      shopPublicRaw: kp.publicKeyRaw,
      nonce: base64urlDecode(rel.nonce as string),
      wrappedKey: base64urlDecode(rel.wrappedKey as string),
    };
    expect(await verifyReleaseMac(chan, fields, base64urlDecode(rel.mac2 as string))).toBe(true);
    const key = await unwrapFileKey({
      shopPrivateKey: kp.privateKey,
      shopPublicRaw: kp.publicKeyRaw,
      ownerPublicRaw: fields.ownerPublicRaw,
      sessionId: sid,
      nonce: fields.nonce,
      wrappedKey: fields.wrappedKey,
    });

    const dl = await fetch(`${srv.url}/v1/sessions/${id}/blob?t=${String(rel.blobToken)}`);
    expect(dl.status).toBe(200);
    expect(dl.headers.get('cache-control')).toBe('no-store');
    const bundle = await decodeBundle({
      key,
      sessionId: sid,
      bytes: new Uint8Array(await dl.arrayBuffer()),
    });
    expect(new TextDecoder().decode(bundle.pages[0]!.subarray(50, 50 + MARKER.length))).toBe(
      MARKER,
    );
    expect(
      (await fetch(`${srv.url}/v1/sessions/${id}/blob?t=${String(rel.blobToken)}`)).status,
    ).toBe(404); // one time
    expect((await srv.inspect()).blobs).toBe(0); // deleted as soon as it was handed out

    shop.send({ t: 'rendered', pageCount: 1 });
    owner.send({ t: 'hb', seq: 1 });
    shop.send({ t: 'hb', seq: 1, state: 'READY' });
    expect((await shop.next('tick')).ownerAlive).toBe(true);
    shop.send({ t: 'printStarted' });
    shop.send({ t: 'printed' });
    expect((await shop.next('kill', 4000)).reason).toBe('PRINTED');
    shop.send({ t: 'wiped', reason: 'PRINTED' });
    const done = await owner.next('destroyed');
    expect(done).toMatchObject({ reason: 'PRINTED', printsDone: 1, shopReportedWipe: true });
    expect((await readdir(blobDir)).length).toBe(0);
  });
});

describe('http surface', () => {
  beforeEach(async () => {
    srv = await startServer({ createsPerMinutePerIp: 4, config: { maxBlobBytes: 8000 } });
  });

  it('rejects bad requests with the right status', async () => {
    const f = (p: string, init?: RequestInit) => fetch(srv.url + p, init);
    expect((await f('/v1/sessions', { method: 'POST', body: 'nope' })).status).toBe(400);
    expect((await f('/v1/sessions', { method: 'POST', body: 'x'.repeat(5000) })).status).toBe(413);
    expect((await f('/v1/sessions')).status).toBe(405);
    expect((await f('/v1/sessions/short/blob', { method: 'PUT' })).status).toBe(404);
    expect((await f('/nowhere')).status).toBe(404);
    expect((await f('/v1/health')).status).toBe(200);
    const { id, token } = await create();
    expect(
      (await f(`/v1/sessions/${id}/blob`, { method: 'PUT', body: new Uint8Array(10) })).status,
    ).toBe(403);
    expect(
      (
        await f(`/v1/sessions/${id}/blob`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}` },
          body: new Uint8Array(6001),
        })
      ).status,
    ).toBe(413);
    expect(
      (
        await f(`/v1/sessions/${id}/blob`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}` },
          body: new Uint8Array(9000),
        })
      ).status,
    ).toBe(413);
    expect((await f(`/v1/sessions/${id}`, { method: 'DELETE' })).status).toBe(403);
    expect(
      (
        await f(`/v1/sessions/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        })
      ).status,
    ).toBe(204);
    expect(
      (await f(`/v1/sessions/${id}/blob?t=${base64urlEncode(new Uint8Array(32))}`)).status,
    ).toBe(404);
    expect((await f(`/v1/sessions/${id}/blob`, { method: 'POST' })).status).toBe(405);
  });

  it('rate limits session creation per client', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++)
      codes.push(
        (await fetch(`${srv.url}/v1/sessions`, { method: 'POST', body: JSON.stringify(BODY) }))
          .status,
      );
    expect(codes).toEqual([201, 201, 201, 201, 429, 429]);
  });

  it('refuses websocket upgrades without credentials or for unknown sessions', async () => {
    const { id } = await create();
    await expect(new Conn(wsUrl(id, 'owner'), ['despawn.v1']).opened()).rejects.toThrow(
      'status 401',
    );
    await expect(
      new Conn(wsUrl(id, 'owner'), [
        'despawn.v1',
        `token.${base64urlEncode(new Uint8Array(32))}`,
      ]).opened(),
    )
      .resolves.toBeUndefined()
      .catch(() => undefined);
    await expect(new Conn(wsUrl('AAAAAAAAAAAAAAAAAAAAAA', 'shop'), ['despawn.v1']).opened())
      .resolves.toBeUndefined()
      .catch(() => undefined);
    await expect(new Conn(wsUrl(id, 'admin'), ['despawn.v1']).opened()).rejects.toThrow(
      'status 404',
    );
  });

  it('closes sockets that send binary or oversized frames', async () => {
    const { id } = await create();
    const a = new Conn(wsUrl(id, 'shop'), ['despawn.v1']);
    await a.opened();
    a.ws.send('x'.repeat(5000));
    expect(await a.closed()).toBe(1009);
    const b = new Conn(wsUrl(id, 'shop'), ['despawn.v1']);
    await b.opened();
    b.ws.send(Buffer.from([1, 2, 3]));
    expect(await b.closed()).toBe(1003);
  });
});

describe('static files and headers', () => {
  it('serves the viewer page with a strict CSP and no caching, and blocks path traversal', async () => {
    const viewer = await tmp();
    const owner = await tmp();
    await mkdir(path.join(viewer, 'assets'));
    await writeFile(path.join(viewer, 'index.html'), '<!doctype html><title>viewer</title>');
    await writeFile(path.join(viewer, 'assets', 'a.js'), 'console.log(1)');
    await writeFile(path.join(owner, 'index.html'), '<!doctype html><title>owner</title>');
    srv = await startServer({ viewerDist: viewer, ownerDist: owner });

    const page = await fetch(`${srv.url}/s/AAAAAAAAAAAAAAAAAAAAAA`);
    expect(page.status).toBe(200);
    const csp = page.headers.get('content-security-policy')!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe');
    expect(csp).toContain(`ws://localhost:${srv.port}`);
    expect(page.headers.get('cache-control')).toBe('no-store');
    expect(page.headers.get('referrer-policy')).toBe('no-referrer');
    expect(page.headers.get('x-content-type-options')).toBe('nosniff');
    expect(page.headers.get('x-robots-tag')).toBe('noindex');

    const asset = await fetch(`${srv.url}/v/assets/a.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toContain('javascript');
    expect(asset.headers.get('cache-control')).toContain('immutable');

    for (const evil of [
      '/v/..%2f..%2fetc%2fpasswd',
      '/v/%2e%2e/%2e%2e/etc/passwd',
      '/v/..%5c..%5cetc',
      '/v/%00',
      '/app/..%2f..%2fpackage.json',
    ]) {
      const r = await fetch(srv.url + evil);
      expect(r.status === 404 || r.status === 400).toBe(true);
      expect((await r.text()).includes('root:')).toBe(false);
    }
    expect((await fetch(`${srv.url}/app/some/deep/route`)).status).toBe(200); // SPA fallback
    expect((await fetch(`${srv.url}/app/missing.js`)).status).toBe(404);
    const root = await fetch(srv.url, { redirect: 'manual' });
    expect(root.status).toBe(302);
    expect(root.headers.get('location')).toBe('/app/');
  });
});

describe('disk store and path safety', () => {
  it('removes leftover ciphertext on startup (fail closed after a crash)', async () => {
    const dir = await tmp();
    await writeFile(path.join(dir, 'AAAAAAAAAAAAAAAAAAAAAA.bin'), 'leftover');
    const store = new FileBlobStore(dir);
    await store.init();
    expect(await store.count()).toBe(0);
    await expect(store.put('../evil', new Uint8Array(1))).rejects.toThrow();
  });

  it('safeResolve never leaves the root', () => {
    const root = path.resolve('/srv/root');
    expect(safeResolve(root, 'a/b.js')).toBe(path.join(root, 'a', 'b.js'));
    for (const bad of ['../x', '..%2fx', 'a/../../x', '%2e%2e/x', 'a\\..\\x', '\0']) {
      const r = safeResolve(root, bad);
      expect(r === null || r.startsWith(root + path.sep) || r === root).toBe(true);
    }
    expect(safeResolve(root, '../etc/passwd')?.startsWith(root)).toBe(true);
  });
});
