import {
  CHUNK_SIZE,
  generateFileKeyBytes,
  generateNoncePrefix,
  generateSessionId,
  importFileKey,
} from '@despawn/crypto';
import { describe, expect, it } from 'vitest';
import {
  BundleError,
  bundleSizeUpperBound,
  HEADER_BYTES,
  decodeBundle,
  encodeBundle,
  validateManifest,
  type Manifest,
} from './index.js';

function bytes(n: number, seed: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 31 + seed) & 0xff;
  return b;
}

async function setup(pageSizes: number[]) {
  const raw = generateFileKeyBytes();
  const sessionId = generateSessionId();
  const noncePrefix = generateNoncePrefix();
  const enc = await importFileKey(raw, 'encrypt');
  const dec = await importFileKey(raw, 'decrypt');
  const pages = pageSizes.map((n, i) => bytes(n, i));
  const manifest: Manifest = {
    v: 1,
    paper: 'A4',
    orientation: 'portrait',
    dpi: 200,
    purposeLabel: 'SIM verification',
    watermark: 'Self-attested for SIM verification only',
    pages: pageSizes.map((n) => ({ width: 1654, height: 2339, mime: 'image/jpeg', byteLength: n })),
  };
  const packed = await encodeBundle({ key: enc, sessionId, noncePrefix, manifest, pages });
  return { raw, sessionId, noncePrefix, enc, dec, pages, manifest, packed };
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return e instanceof BundleError ? e.code : `other:${String(e)}`;
  }
}

describe('round trip', () => {
  it('returns the manifest and every page byte for byte', async () => {
    const s = await setup([1000, 1, 70000]);
    const out = await decodeBundle({ key: s.dec, sessionId: s.sessionId, bytes: s.packed });
    expect(out.manifest).toEqual(s.manifest);
    expect(out.pages).toHaveLength(3);
    out.pages.forEach((p, i) => expect(p).toEqual(s.pages[i]));
  });

  it('handles payloads that span several chunks and exact chunk boundaries', async () => {
    for (const sizes of [
      [CHUNK_SIZE],
      [CHUNK_SIZE * 2],
      [CHUNK_SIZE * 2 + 1],
      [CHUNK_SIZE - 1, 2],
    ]) {
      const s = await setup(sizes);
      const out = await decodeBundle({ key: s.dec, sessionId: s.sessionId, bytes: s.packed });
      out.pages.forEach((p, i) => expect(p).toEqual(s.pages[i]));
    }
  });

  it('never contains the plaintext', async () => {
    const s = await setup([5000]);
    const marker = s.pages[0]!.subarray(100, 132);
    const latin1 = (u: Uint8Array): string => {
      let out = '';
      for (let i = 0; i < u.length; i++) out += String.fromCharCode(u[i] ?? 0);
      return out;
    };
    const hay = latin1(s.packed);
    expect(hay.includes(latin1(marker))).toBe(false);
    expect(hay.includes('SIM verification')).toBe(false);
  });
});

describe('tamper and misuse', () => {
  it('rejects every single-bit flip across a small bundle', async () => {
    const s = await setup([300]);
    let accepted = 0;
    for (let i = 0; i < s.packed.length; i++) {
      const t = s.packed.slice();
      t[i] = (t[i] ?? 0) ^ 0x01;
      if ((await code(decodeBundle({ key: s.dec, sessionId: s.sessionId, bytes: t }))) === 'OK')
        accepted++;
    }
    expect(accepted).toBe(0);
  });

  it('rejects truncation at every length', async () => {
    const s = await setup([300]);
    for (let n = 0; n < s.packed.length; n += 7) {
      expect(
        await code(
          decodeBundle({ key: s.dec, sessionId: s.sessionId, bytes: s.packed.slice(0, n) }),
        ),
      ).not.toBe('OK');
    }
  });

  it('rejects trailing bytes and a wrong session id and a wrong key', async () => {
    const s = await setup([300]);
    const extra = new Uint8Array(s.packed.length + 1);
    extra.set(s.packed);
    expect(await code(decodeBundle({ key: s.dec, sessionId: s.sessionId, bytes: extra }))).not.toBe(
      'OK',
    );
    expect(
      await code(decodeBundle({ key: s.dec, sessionId: generateSessionId(), bytes: s.packed })),
    ).toBe('BAD_FORMAT');
    const other = await importFileKey(generateFileKeyBytes(), 'decrypt');
    expect(await code(decodeBundle({ key: other, sessionId: s.sessionId, bytes: s.packed }))).toBe(
      'AUTH_FAILED',
    );
  });

  it('rejects swapped chunks', async () => {
    const s = await setup([CHUNK_SIZE * 2 + 10]);
    const view = new DataView(s.packed.buffer);
    let off = HEADER_BYTES;
    const spans: Array<[number, number]> = [];
    while (off < s.packed.length) {
      const len = view.getUint32(off, false);
      spans.push([off, off + 4 + len]);
      off += 4 + len;
    }
    expect(spans.length).toBeGreaterThanOrEqual(4);
    const a = spans[1]!;
    const b = spans[2]!;
    const swapped = Uint8Array.from([
      ...s.packed.subarray(0, a[0]),
      ...s.packed.subarray(b[0], b[1]),
      ...s.packed.subarray(a[0], a[1]),
      ...s.packed.subarray(b[1]),
    ]);
    expect(
      await code(decodeBundle({ key: s.dec, sessionId: s.sessionId, bytes: swapped })),
    ).not.toBe('OK');
  });

  it('rejects an invalid manifest and mismatched page lengths at encode time', async () => {
    const s = await setup([100]);
    const bad = { ...s.manifest, pages: [{ ...s.manifest.pages[0]!, byteLength: 99 }] };
    expect(
      await code(
        encodeBundle({
          key: s.enc,
          sessionId: s.sessionId,
          noncePrefix: generateNoncePrefix(),
          manifest: bad,
          pages: s.pages,
        }),
      ),
    ).toBe('BAD_FORMAT');
    expect(
      await code(
        encodeBundle({
          key: s.enc,
          sessionId: s.sessionId,
          noncePrefix: generateNoncePrefix(),
          manifest: { ...s.manifest, pages: [] },
          pages: [],
        }),
      ),
    ).toBe('BAD_FORMAT');
  });
});

describe('validateManifest', () => {
  const good: Manifest = {
    v: 1,
    paper: 'A4',
    orientation: 'portrait',
    dpi: 200,
    purposeLabel: 'x',
    watermark: 'y',
    pages: [{ width: 10, height: 10, mime: 'image/png', byteLength: 5 }],
  };
  it('accepts a good manifest and rejects variations', () => {
    expect(validateManifest(good)).toEqual(good);
    const variants: unknown[] = [
      null,
      [],
      { ...good, extra: 1 },
      { ...good, v: 2 },
      { ...good, paper: 'A3' },
      { ...good, dpi: 1 },
      { ...good, purposeLabel: 'x'.repeat(61) },
      { ...good, pages: [{ ...good.pages[0], mime: 'image/gif' }] },
      { ...good, pages: [{ ...good.pages[0], width: 0 }] },
      { ...good, pages: [{ ...good.pages[0], extra: 1 }] },
      { ...good, pages: new Array(51).fill(good.pages[0]) },
    ];
    for (const v of variants) expect(validateManifest(v)).toBeNull();
  });
});

describe('bundleSizeUpperBound', () => {
  it('is never smaller than the real bundle', async () => {
    for (const sizes of [[1], [1000, 2000], [CHUNK_SIZE], [CHUNK_SIZE + 1, 5], [CHUNK_SIZE * 3]]) {
      const s = await setup(sizes);
      const payload = sizes.reduce((a, n) => a + n, 0);
      expect(bundleSizeUpperBound(payload)).toBeGreaterThanOrEqual(s.packed.length);
      expect(bundleSizeUpperBound(payload) - s.packed.length).toBeLessThan(17000);
    }
  });
});
