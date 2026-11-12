import { CryptoError } from './errors.js';

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const DECODE_TABLE: number[] = new Array(256).fill(-1);
for (let i = 0; i < CHARS.length; i++) {
  const code = CHARS.charCodeAt(i);
  DECODE_TABLE[code] = i;
}

export function base64urlEncode(b: Uint8Array): string {
  let result = '';
  const len = b.length;
  const rem = len % 3;
  const mainLen = len - rem;

  for (let i = 0; i < mainLen; i += 3) {
    const b0 = b[i]!;
    const b1 = b[i + 1]!;
    const b2 = b[i + 2]!;

    result += CHARS[(b0 >> 2) & 0x3f];
    result += CHARS[((b0 & 0x03) << 4) | ((b1 >> 4) & 0x0f)];
    result += CHARS[((b1 & 0x0f) << 2) | ((b2 >> 6) & 0x03)];
    result += CHARS[b2 & 0x3f];
  }

  if (rem === 1) {
    const b0 = b[mainLen]!;
    result += CHARS[(b0 >> 2) & 0x3f];
    result += CHARS[(b0 & 0x03) << 4];
  } else if (rem === 2) {
    const b0 = b[mainLen]!;
    const b1 = b[mainLen + 1]!;
    result += CHARS[(b0 >> 2) & 0x3f];
    result += CHARS[((b0 & 0x03) << 4) | ((b1 >> 4) & 0x0f)];
    result += CHARS[(b1 & 0x0f) << 2];
  }

  return result;
}

export function base64urlDecode(s: string): Uint8Array {
  // Reject length mod 4 = 1, whitespace, '=', or characters outside [A-Za-z0-9-_]
  if (s.length % 4 === 1 || !/^[A-Za-z0-9_-]*$/.test(s)) {
    throw new CryptoError('INVALID_INPUT');
  }

  const sLen = s.length;
  if (sLen === 0) {
    return new Uint8Array(0);
  }

  const rem = sLen % 4;
  const numFullGroups = Math.floor(sLen / 4);
  const totalBytes = numFullGroups * 3 + (rem === 2 ? 1 : rem === 3 ? 2 : 0);
  const out = new Uint8Array(totalBytes);

  let inIdx = 0;
  let outIdx = 0;

  for (let i = 0; i < numFullGroups; i++) {
    const c0 = DECODE_TABLE[s.charCodeAt(inIdx++)]!;
    const c1 = DECODE_TABLE[s.charCodeAt(inIdx++)]!;
    const c2 = DECODE_TABLE[s.charCodeAt(inIdx++)]!;
    const c3 = DECODE_TABLE[s.charCodeAt(inIdx++)]!;

    if (c0 === -1 || c1 === -1 || c2 === -1 || c3 === -1) {
      throw new CryptoError('INVALID_INPUT');
    }

    out[outIdx++] = (c0 << 2) | (c1 >> 4);
    out[outIdx++] = ((c1 & 0x0f) << 4) | (c2 >> 2);
    out[outIdx++] = ((c2 & 0x03) << 6) | c3;
  }

  if (rem === 2) {
    const c0 = DECODE_TABLE[s.charCodeAt(inIdx++)]!;
    const c1 = DECODE_TABLE[s.charCodeAt(inIdx++)]!;
    if (c0 === -1 || c1 === -1) {
      throw new CryptoError('INVALID_INPUT');
    }
    out[outIdx++] = (c0 << 2) | (c1 >> 4);
  } else if (rem === 3) {
    const c0 = DECODE_TABLE[s.charCodeAt(inIdx++)]!;
    const c1 = DECODE_TABLE[s.charCodeAt(inIdx++)]!;
    const c2 = DECODE_TABLE[s.charCodeAt(inIdx++)]!;
    if (c0 === -1 || c1 === -1 || c2 === -1) {
      throw new CryptoError('INVALID_INPUT');
    }
    out[outIdx++] = (c0 << 2) | (c1 >> 4);
    out[outIdx++] = ((c1 & 0x0f) << 4) | (c2 >> 2);
  }

  // Strict non-canonical check: must re-encode to identical input string
  if (base64urlEncode(out) !== s) {
    throw new CryptoError('INVALID_INPUT');
  }

  return out;
}
