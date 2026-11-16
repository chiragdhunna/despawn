/**
 * Print bundle: the encrypted container that carries page images from the owner's phone to the
 * shop viewer. Byte layout (all integers big-endian):
 *
 *   header  : "DSPN" | version u8 | sessionId[16] | noncePrefix[4] | chunkSize u32     (29 bytes)
 *   body    : repeated { sealedLength u32 | sealed }
 *   chunk 0 : manifest (UTF-8 JSON), sealed, not final
 *   chunk 1+: concatenated page image bytes in pieces of at most chunkSize, last one final
 *
 * Each sealed chunk is produced by @despawn/crypto (AES-256-GCM with index-bound nonce and AAD),
 * so reordering, truncation, splicing and cross-session replay all fail authentication.
 */
import {
  CHUNK_SIZE,
  CryptoError,
  GCM_TAG_BYTES,
  NONCE_PREFIX_BYTES,
  SESSION_ID_BYTES,
  concatBytes,
  createChunkDecryptor,
  createChunkEncryptor,
} from '@despawn/crypto';
import { MAX_BLOB_BYTES, MAX_PAGES } from '@despawn/protocol';

export const VERSION = '0.0.0';

export const BUNDLE_MAGIC = [0x44, 0x53, 0x50, 0x4e]; // "DSPN"
export const BUNDLE_VERSION = 1;
export const HEADER_BYTES = 4 + 1 + SESSION_ID_BYTES + NONCE_PREFIX_BYTES + 4;
export const MAX_MANIFEST_BYTES = 16384;
export const MAX_PAGE_DIMENSION = 10000;

export type PaperSize = 'A4' | 'A5' | 'Letter';
export type Orientation = 'portrait' | 'landscape';
export type PageMime = 'image/jpeg' | 'image/png';

export interface ManifestPage {
  readonly width: number;
  readonly height: number;
  readonly mime: PageMime;
  readonly byteLength: number;
}

export interface Manifest {
  readonly v: 1;
  readonly paper: PaperSize;
  readonly orientation: Orientation;
  readonly dpi: number;
  /** Shown on the shop screen. Never contains personal data unless the owner typed it. */
  readonly purposeLabel: string;
  /** The watermark text baked into the pages, for display only. */
  readonly watermark: string;
  readonly pages: readonly ManifestPage[];
}

export type BundleErrorCode = 'BAD_FORMAT' | 'AUTH_FAILED' | 'LIMIT';

export class BundleError extends Error {
  readonly code: BundleErrorCode;
  constructor(code: BundleErrorCode) {
    super(
      code === 'BAD_FORMAT'
        ? 'bad bundle format'
        : code === 'AUTH_FAILED'
          ? 'bundle authentication failed'
          : 'bundle limit exceeded',
    );
    this.name = 'BundleError';
    this.code = code;
    Object.setPrototypeOf(this, BundleError.prototype);
  }
}

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, false);
  return b;
}

function isInt(x: unknown, min: number, max: number): x is number {
  return typeof x === 'number' && Number.isSafeInteger(x) && x >= min && x <= max;
}

function isPlain(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

function hasOnly(o: Record<string, unknown>, keys: string[]): boolean {
  const own = Object.keys(o);
  return own.length === keys.length && own.every((k) => keys.indexOf(k) !== -1);
}

/** Strict manifest validation. Returns a fresh object, never the input. */
export function validateManifest(x: unknown): Manifest | null {
  if (
    !isPlain(x) ||
    !hasOnly(x, ['v', 'paper', 'orientation', 'dpi', 'purposeLabel', 'watermark', 'pages'])
  ) {
    return null;
  }
  const { v, paper, orientation, dpi, purposeLabel, watermark, pages } = x;
  if (v !== 1 || (paper !== 'A4' && paper !== 'A5' && paper !== 'Letter')) return null;
  if (orientation !== 'portrait' && orientation !== 'landscape') return null;
  if (!isInt(dpi, 72, 600)) return null;
  if (typeof purposeLabel !== 'string' || purposeLabel.length > 60) return null;
  if (typeof watermark !== 'string' || watermark.length > 200) return null;
  if (!Array.isArray(pages) || pages.length < 1 || pages.length > MAX_PAGES) return null;
  const out: ManifestPage[] = [];
  for (const p of pages as unknown[]) {
    if (!isPlain(p) || !hasOnly(p, ['width', 'height', 'mime', 'byteLength'])) return null;
    if (!isInt(p.width, 1, MAX_PAGE_DIMENSION) || !isInt(p.height, 1, MAX_PAGE_DIMENSION))
      return null;
    if (p.mime !== 'image/jpeg' && p.mime !== 'image/png') return null;
    if (!isInt(p.byteLength, 1, MAX_BLOB_BYTES)) return null;
    out.push({ width: p.width, height: p.height, mime: p.mime, byteLength: p.byteLength });
  }
  return { v: 1, paper, orientation, dpi, purposeLabel, watermark, pages: out };
}

/**
 * An upper bound on the size of a bundle holding payloadBytes of page data. Used to declare the
 * upload size to the relay before the session id (and therefore the exact bundle) exists.
 */
export function bundleSizeUpperBound(payloadBytes: number): number {
  const chunks = Math.max(1, Math.ceil(payloadBytes / CHUNK_SIZE));
  const manifest = MAX_MANIFEST_BYTES + GCM_TAG_BYTES + 4;
  return HEADER_BYTES + manifest + payloadBytes + chunks * (GCM_TAG_BYTES + 4);
}

export interface EncodeParams {
  /** AES-GCM key with the 'encrypt' usage (see importFileKey). */
  readonly key: CryptoKey;
  readonly sessionId: Uint8Array;
  readonly noncePrefix: Uint8Array;
  readonly manifest: Manifest;
  /** Page image bytes, in the same order as manifest.pages. */
  readonly pages: readonly Uint8Array[];
}

export async function encodeBundle(p: EncodeParams): Promise<Uint8Array> {
  const manifest = validateManifest(p.manifest);
  if (manifest === null || manifest.pages.length !== p.pages.length) {
    throw new BundleError('BAD_FORMAT');
  }
  let total = 0;
  for (let i = 0; i < p.pages.length; i++) {
    const page = p.pages[i];
    if (page === undefined || page.length !== manifest.pages[i]?.byteLength) {
      throw new BundleError('BAD_FORMAT');
    }
    total += page.length;
  }
  if (total > MAX_BLOB_BYTES) throw new BundleError('LIMIT');
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  if (manifestBytes.length > MAX_MANIFEST_BYTES) throw new BundleError('LIMIT');

  const payload = concatBytes(...p.pages);
  const ctx = { sessionId: p.sessionId, noncePrefix: p.noncePrefix };
  const enc = createChunkEncryptor(p.key, ctx);
  const parts: Uint8Array[] = [
    concatBytes(
      Uint8Array.from(BUNDLE_MAGIC),
      Uint8Array.of(BUNDLE_VERSION),
      p.sessionId,
      p.noncePrefix,
      u32(CHUNK_SIZE),
    ),
  ];
  const first = await enc.seal(manifestBytes, false);
  parts.push(u32(first.length), first);
  const pieces = Math.max(1, Math.ceil(payload.length / CHUNK_SIZE));
  for (let i = 0; i < pieces; i++) {
    const slice = payload.subarray(i * CHUNK_SIZE, Math.min(payload.length, (i + 1) * CHUNK_SIZE));
    const sealed = await enc.seal(slice, i === pieces - 1);
    parts.push(u32(sealed.length), sealed);
  }
  const out = concatBytes(...parts);
  if (out.length > MAX_BLOB_BYTES) throw new BundleError('LIMIT');
  return out;
}

export interface DecodeParams {
  /** AES-GCM key with the 'decrypt' usage. */
  readonly key: CryptoKey;
  /** The session the bundle must belong to. */
  readonly sessionId: Uint8Array;
  readonly bytes: Uint8Array;
}

export interface DecodedBundle {
  readonly manifest: Manifest;
  readonly pages: Uint8Array[];
}

export async function decodeBundle(p: DecodeParams): Promise<DecodedBundle> {
  const b = p.bytes;
  if (b.length < HEADER_BYTES || b.length > MAX_BLOB_BYTES) throw new BundleError('BAD_FORMAT');
  for (let i = 0; i < 4; i++) {
    if (b[i] !== BUNDLE_MAGIC[i]) throw new BundleError('BAD_FORMAT');
  }
  if (b[4] !== BUNDLE_VERSION) throw new BundleError('BAD_FORMAT');
  const sid = b.subarray(5, 5 + SESSION_ID_BYTES);
  if (p.sessionId.length !== SESSION_ID_BYTES) throw new BundleError('BAD_FORMAT');
  let same = 0;
  for (let i = 0; i < SESSION_ID_BYTES; i++) same |= (sid[i] ?? 0) ^ (p.sessionId[i] ?? 0);
  if (same !== 0) throw new BundleError('BAD_FORMAT');
  const noncePrefix = b.subarray(5 + SESSION_ID_BYTES, 5 + SESSION_ID_BYTES + NONCE_PREFIX_BYTES);
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const chunkSize = view.getUint32(HEADER_BYTES - 4, false);
  if (chunkSize !== CHUNK_SIZE) throw new BundleError('BAD_FORMAT');

  const dec = createChunkDecryptor(p.key, {
    sessionId: p.sessionId,
    noncePrefix: new Uint8Array(noncePrefix),
  });
  let offset = HEADER_BYTES;
  let manifest: Manifest | null = null;
  const payloadParts: Uint8Array[] = [];
  let payloadBytes = 0;
  let sawFinal = false;
  try {
    while (offset < b.length) {
      if (sawFinal || offset + 4 > b.length) throw new BundleError('BAD_FORMAT');
      const len = view.getUint32(offset, false);
      offset += 4;
      if (len < GCM_TAG_BYTES || len > CHUNK_SIZE + GCM_TAG_BYTES || offset + len > b.length) {
        throw new BundleError('BAD_FORMAT');
      }
      const opened = await dec.open(b.subarray(offset, offset + len));
      offset += len;
      if (manifest === null) {
        if (opened.isFinal || opened.plaintext.length > MAX_MANIFEST_BYTES) {
          throw new BundleError('BAD_FORMAT');
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(opened.plaintext));
        } catch {
          throw new BundleError('BAD_FORMAT');
        }
        manifest = validateManifest(parsed);
        if (manifest === null) throw new BundleError('BAD_FORMAT');
      } else {
        payloadBytes += opened.plaintext.length;
        if (payloadBytes > MAX_BLOB_BYTES) throw new BundleError('LIMIT');
        payloadParts.push(opened.plaintext);
        sawFinal = opened.isFinal;
      }
    }
    dec.finish();
  } catch (e) {
    if (e instanceof BundleError) throw e;
    if (e instanceof CryptoError) throw new BundleError('AUTH_FAILED');
    throw new BundleError('BAD_FORMAT');
  }
  if (manifest === null || !sawFinal) throw new BundleError('BAD_FORMAT');
  const payload = concatBytes(...payloadParts);
  let expected = 0;
  for (const pg of manifest.pages) expected += pg.byteLength;
  if (expected !== payload.length) throw new BundleError('BAD_FORMAT');
  const pages: Uint8Array[] = [];
  let at = 0;
  for (const pg of manifest.pages) {
    pages.push(payload.slice(at, at + pg.byteLength));
    at += pg.byteLength;
  }
  return { manifest, pages };
}
