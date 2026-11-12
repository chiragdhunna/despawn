import { CryptoError } from './errors.js';

export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let totalLength = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part !== undefined) {
      totalLength += part.length;
    }
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part !== undefined) {
      result.set(part, offset);
      offset += part.length;
    }
  }

  return result;
}

export function u32be(n: number): Uint8Array {
  if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) {
    throw new CryptoError('INVALID_INPUT');
  }

  const bytes = new Uint8Array(4);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(0, n, false);
  return bytes;
}

export function u64be(n: number): Uint8Array {
  if (!Number.isSafeInteger(n) || n < 0 || n > Number.MAX_SAFE_INTEGER) {
    throw new CryptoError('INVALID_INPUT');
  }

  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const high = Math.floor(n / 0x100000000);
  const low = n >>> 0;
  view.setUint32(0, high, false);
  view.setUint32(4, low, false);
  return bytes;
}

export function bytesToHex(b: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < b.length; i++) {
    const byte = b[i];
    if (byte !== undefined) {
      hex += (byte < 16 ? '0' : '') + byte.toString(16);
    }
  }
  return hex;
}

export function hexToBytes(h: string): Uint8Array {
  if (h.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(h)) {
    throw new CryptoError('INVALID_INPUT');
  }

  const len = h.length / 2;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = parseInt(h.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
