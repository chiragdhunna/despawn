import { base64urlDecode } from '@despawn/crypto';
import { MAX_FRAME_BYTES } from './constants.js';
import type { Ua } from './types.js';

const encoder = new TextEncoder();

export function checkFrameSize(frame: unknown): 'OK' | 'TOO_LARGE' | 'BAD_MESSAGE' {
  if (typeof frame !== 'string') {
    return 'BAD_MESSAGE';
  }
  if (frame.length > MAX_FRAME_BYTES) {
    return 'TOO_LARGE';
  }
  if (encoder.encode(frame).length > MAX_FRAME_BYTES) {
    return 'TOO_LARGE';
  }
  return 'OK';
}

export function isPlainObject(x: unknown): x is Record<string, unknown> {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) {
    return false;
  }
  const proto = Object.getPrototypeOf(x);
  if (proto !== Object.prototype && proto !== null) {
    return false;
  }
  if (
    Object.prototype.hasOwnProperty.call(x, '__proto__') ||
    Object.prototype.hasOwnProperty.call(x, 'constructor') ||
    Object.prototype.hasOwnProperty.call(x, 'prototype')
  ) {
    return false;
  }
  return true;
}

export function checkObjectKeys(
  x: Record<string, unknown>,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): boolean {
  const keys = Object.keys(x);
  for (let i = 0; i < requiredKeys.length; i++) {
    const k = requiredKeys[i];
    if (!Object.prototype.hasOwnProperty.call(x, k!)) {
      return false;
    }
  }
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!;
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') {
      return false;
    }
    let allowed = false;
    for (let j = 0; j < requiredKeys.length; j++) {
      if (k === requiredKeys[j]) {
        allowed = true;
        break;
      }
    }
    if (!allowed) {
      for (let j = 0; j < optionalKeys.length; j++) {
        if (k === optionalKeys[j]) {
          allowed = true;
          break;
        }
      }
    }
    if (!allowed) {
      return false;
    }
  }
  return true;
}

export function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if ((c >= 0x00 && c <= 0x1f) || c === 0x7f) {
      return true;
    }
  }
  return false;
}

export function isIntegerInRange(x: unknown, min: number, max: number): x is number {
  return typeof x === 'number' && Number.isSafeInteger(x) && x >= min && x <= max;
}

export function isShortText(x: unknown): x is string {
  return typeof x === 'string' && x.length >= 1 && x.length <= 40 && !hasControlChars(x);
}

export function isRegion(x: unknown): x is string {
  return typeof x === 'string' && x.length >= 1 && x.length <= 60 && !hasControlChars(x);
}

export function isCountryCode(x: unknown): x is string {
  if (typeof x !== 'string' || x.length !== 2) {
    return false;
  }
  const c0 = x.charCodeAt(0);
  const c1 = x.charCodeAt(1);
  return c0 >= 65 && c0 <= 90 && c1 >= 65 && c1 <= 90;
}

export function isPurposeLabel(x: unknown): x is string {
  return typeof x === 'string' && x.length >= 0 && x.length <= 60 && !hasControlChars(x);
}

export function isChallengeToken(x: unknown): x is string {
  return typeof x === 'string' && x.length >= 1 && x.length <= 2048 && !hasControlChars(x);
}

export function isEpochMs(x: unknown): x is number {
  return isIntegerInRange(x, 0, 4102444800000);
}

export function isSeq(x: unknown): x is number {
  return isIntegerInRange(x, 0, 2147483647);
}

export function isCount(x: unknown): x is number {
  return isIntegerInRange(x, 0, 1000);
}

export function isMillis(x: unknown): x is number {
  return isIntegerInRange(x, 0, 86400000);
}

function checkBinaryField(
  val: unknown,
  expectedBytes: number,
  requireB65FirstByte = false,
): val is string {
  if (typeof val !== 'string') {
    return false;
  }
  try {
    const bytes = base64urlDecode(val);
    if (bytes.byteLength !== expectedBytes) {
      return false;
    }
    if (requireB65FirstByte) {
      if (bytes.length === 0 || bytes[0] !== 0x04) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function isB12(x: unknown): x is string {
  return checkBinaryField(x, 12);
}

export function isB16(x: unknown): x is string {
  return checkBinaryField(x, 16);
}

export function isB32(x: unknown): x is string {
  return checkBinaryField(x, 32);
}

export function isB48(x: unknown): x is string {
  return checkBinaryField(x, 48);
}

export function isB65(x: unknown): x is string {
  return checkBinaryField(x, 65, true);
}

export function isUa(x: unknown, depth = 2): x is Ua {
  if (depth > 3) {
    return false;
  }
  if (!isPlainObject(x)) {
    return false;
  }
  if (!checkObjectKeys(x, ['browser', 'os'])) {
    return false;
  }
  return isShortText(x.browser) && isShortText(x.os);
}
