import { CryptoError } from './errors.js';

export const SPEC_VERSION = 'despawn/v1';
export const SESSION_ID_BYTES = 16;
export const LINK_SECRET_BYTES = 16;
export const FILE_KEY_BYTES = 32;
export const NONCE_PREFIX_BYTES = 4;
export const GCM_IV_BYTES = 12;
export const GCM_TAG_BYTES = 16;
export const P256_PUBLIC_RAW_BYTES = 65;
export const CHUNK_SIZE = 262144;

export function randomBytes(n: number): Uint8Array {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new CryptoError('INVALID_INPUT');
  }

  const out = new Uint8Array(n);
  const MAX_CHUNK = 65536;

  for (let offset = 0; offset < n; offset += MAX_CHUNK) {
    const chunkLength = Math.min(MAX_CHUNK, n - offset);
    globalThis.crypto.getRandomValues(
      new Uint8Array(out.buffer, out.byteOffset + offset, chunkLength),
    );
  }

  return out;
}

export function generateSessionId(): Uint8Array {
  return randomBytes(SESSION_ID_BYTES);
}

export function generateLinkSecret(): Uint8Array {
  return randomBytes(LINK_SECRET_BYTES);
}

export function generateFileKeyBytes(): Uint8Array {
  return randomBytes(FILE_KEY_BYTES);
}

export function generateNoncePrefix(): Uint8Array {
  return randomBytes(NONCE_PREFIX_BYTES);
}
