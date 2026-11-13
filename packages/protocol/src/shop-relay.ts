import {
  checkFrameSize,
  checkObjectKeys,
  isB12,
  isB32,
  isB48,
  isB65,
  isIntegerInRange,
  isMillis,
  isPlainObject,
  isSeq,
  isUa,
} from './check.js';
import {
  MAX_FRAME_BYTES,
  MAX_PAGES,
  MAX_PRINT_LIMIT,
  MIN_PRINT_LIMIT,
  MAX_LIVE_TTL_MS,
  MIN_LIVE_TTL_MS,
  MAX_GRACE_MS,
  MIN_GRACE_MS,
} from './constants.js';
import { isErrorCode, isShopViewState, isShopWipeReason, isTerminalReason } from './enums.js';
import { ProtocolError, type ParseResult } from './errors.js';
import type { RelayToShop, RelayToShopLimits, ShopToRelay } from './types.js';

const encoder = new TextEncoder();

function exceedsBytes(s: string, maxBytes: number): boolean {
  if (s.length > maxBytes) {
    return true;
  }
  return encoder.encode(s).length > maxBytes;
}

export function validateShopToRelay(x: unknown): ShopToRelay | null {
  if (!isPlainObject(x)) {
    return null;
  }
  if (x.v !== 1 || typeof x.t !== 'string') {
    return null;
  }

  switch (x.t) {
    case 'hello': {
      if (!checkObjectKeys(x, ['v', 't', 'shopPub', 'mac', 'ua'])) {
        return null;
      }
      const shopPub = x.shopPub;
      const mac = x.mac;
      const ua = x.ua;
      if (!isB65(shopPub) || !isB32(mac) || !isUa(ua, 2)) {
        return null;
      }
      return {
        v: 1,
        t: 'hello',
        shopPub,
        mac,
        ua: { browser: ua.browser, os: ua.os },
      };
    }
    case 'hb': {
      if (!checkObjectKeys(x, ['v', 't', 'seq', 'state'])) {
        return null;
      }
      const seq = x.seq;
      const state = x.state;
      if (!isSeq(seq) || !isShopViewState(state)) {
        return null;
      }
      return {
        v: 1,
        t: 'hb',
        seq,
        state,
      };
    }
    case 'rendered': {
      if (!checkObjectKeys(x, ['v', 't', 'pageCount'])) {
        return null;
      }
      const pageCount = x.pageCount;
      if (!isIntegerInRange(pageCount, 1, MAX_PAGES)) {
        return null;
      }
      return {
        v: 1,
        t: 'rendered',
        pageCount,
      };
    }
    case 'printStarted': {
      if (!checkObjectKeys(x, ['v', 't'])) {
        return null;
      }
      return {
        v: 1,
        t: 'printStarted',
      };
    }
    case 'printed': {
      if (!checkObjectKeys(x, ['v', 't'])) {
        return null;
      }
      return {
        v: 1,
        t: 'printed',
      };
    }
    case 'wiped': {
      if (!checkObjectKeys(x, ['v', 't', 'reason'])) {
        return null;
      }
      const reason = x.reason;
      if (!isShopWipeReason(reason)) {
        return null;
      }
      return {
        v: 1,
        t: 'wiped',
        reason,
      };
    }
    default:
      return null;
  }
}

export function parseShopToRelay(frame: string): ParseResult<ShopToRelay> {
  const sizeCheck = checkFrameSize(frame);
  if (sizeCheck === 'TOO_LARGE') {
    return { ok: false, code: 'TOO_LARGE' };
  }
  if (sizeCheck === 'BAD_MESSAGE') {
    return { ok: false, code: 'BAD_MESSAGE' };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(frame);
  } catch {
    return { ok: false, code: 'BAD_MESSAGE' };
  }

  const msg = validateShopToRelay(raw);
  if (msg === null) {
    return { ok: false, code: 'BAD_MESSAGE' };
  }
  return { ok: true, msg };
}

export function serializeShopToRelay(m: ShopToRelay, maxBytes: number = MAX_FRAME_BYTES): string {
  const valid = validateShopToRelay(m);
  if (valid === null) {
    throw new ProtocolError('BAD_MESSAGE');
  }
  const json = JSON.stringify(valid);
  if (exceedsBytes(json, maxBytes)) {
    throw new ProtocolError('TOO_LARGE');
  }
  return json;
}

export function validateRelayToShop(x: unknown): RelayToShop | null {
  if (!isPlainObject(x)) {
    return null;
  }
  if (x.v !== 1 || typeof x.t !== 'string') {
    return null;
  }

  switch (x.t) {
    case 'released': {
      if (
        !checkObjectKeys(x, [
          'v',
          't',
          'ownerPub',
          'nonce',
          'wrappedKey',
          'mac2',
          'blobToken',
          'limits',
        ])
      ) {
        return null;
      }
      const ownerPub = x.ownerPub;
      const nonce = x.nonce;
      const wrappedKey = x.wrappedKey;
      const mac2 = x.mac2;
      const blobToken = x.blobToken;
      if (
        !isB65(ownerPub) ||
        !isB12(nonce) ||
        !isB48(wrappedKey) ||
        !isB32(mac2) ||
        !isB32(blobToken)
      ) {
        return null;
      }
      if (!isPlainObject(x.limits)) {
        return null;
      }
      const limits = x.limits;
      if (!checkObjectKeys(limits, ['liveTtlMs', 'printLimit', 'destroyAfterPrint', 'graceMs'])) {
        return null;
      }
      const liveTtlMs = limits.liveTtlMs;
      const printLimit = limits.printLimit;
      const destroyAfterPrint = limits.destroyAfterPrint;
      const graceMs = limits.graceMs;
      if (
        !isIntegerInRange(liveTtlMs, MIN_LIVE_TTL_MS, MAX_LIVE_TTL_MS) ||
        !isIntegerInRange(printLimit, MIN_PRINT_LIMIT, MAX_PRINT_LIMIT) ||
        typeof destroyAfterPrint !== 'boolean' ||
        !isIntegerInRange(graceMs, MIN_GRACE_MS, MAX_GRACE_MS)
      ) {
        return null;
      }
      const parsedLimits: RelayToShopLimits = {
        liveTtlMs,
        printLimit,
        destroyAfterPrint,
        graceMs,
      };
      return {
        v: 1,
        t: 'released',
        ownerPub,
        nonce,
        wrappedKey,
        mac2,
        blobToken,
        limits: parsedLimits,
      };
    }
    case 'denied': {
      if (!checkObjectKeys(x, ['v', 't'])) {
        return null;
      }
      return {
        v: 1,
        t: 'denied',
      };
    }
    case 'tick': {
      if (!checkObjectKeys(x, ['v', 't', 'ownerAlive', 'remainingMs'])) {
        return null;
      }
      const ownerAlive = x.ownerAlive;
      const remainingMs = x.remainingMs;
      if (typeof ownerAlive !== 'boolean') {
        return null;
      }
      if (remainingMs !== null && !isMillis(remainingMs)) {
        return null;
      }
      return {
        v: 1,
        t: 'tick',
        ownerAlive,
        remainingMs,
      };
    }
    case 'kill': {
      if (!checkObjectKeys(x, ['v', 't', 'reason'])) {
        return null;
      }
      const reason = x.reason;
      if (!isTerminalReason(reason)) {
        return null;
      }
      return {
        v: 1,
        t: 'kill',
        reason,
      };
    }
    case 'error': {
      if (!checkObjectKeys(x, ['v', 't', 'code'])) {
        return null;
      }
      const code = x.code;
      if (!isErrorCode(code)) {
        return null;
      }
      return {
        v: 1,
        t: 'error',
        code,
      };
    }
    default:
      return null;
  }
}

export function parseRelayToShop(frame: string): ParseResult<RelayToShop> {
  const sizeCheck = checkFrameSize(frame);
  if (sizeCheck === 'TOO_LARGE') {
    return { ok: false, code: 'TOO_LARGE' };
  }
  if (sizeCheck === 'BAD_MESSAGE') {
    return { ok: false, code: 'BAD_MESSAGE' };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(frame);
  } catch {
    return { ok: false, code: 'BAD_MESSAGE' };
  }

  const msg = validateRelayToShop(raw);
  if (msg === null) {
    return { ok: false, code: 'BAD_MESSAGE' };
  }
  return { ok: true, msg };
}

export function serializeRelayToShop(m: RelayToShop, maxBytes: number = MAX_FRAME_BYTES): string {
  const valid = validateRelayToShop(m);
  if (valid === null) {
    throw new ProtocolError('BAD_MESSAGE');
  }
  const json = JSON.stringify(valid);
  if (exceedsBytes(json, maxBytes)) {
    throw new ProtocolError('TOO_LARGE');
  }
  return json;
}
