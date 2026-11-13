import {
  checkFrameSize,
  checkObjectKeys,
  isB12,
  isB16,
  isB32,
  isB48,
  isB65,
  isCountryCode,
  isCount,
  isEpochMs,
  isMillis,
  isPlainObject,
  isRegion,
  isSeq,
  isUa,
} from './check.js';
import { MAX_FRAME_BYTES } from './constants.js';
import { isErrorCode, isSessionState, isTerminalReason } from './enums.js';
import { ProtocolError, type ParseResult } from './errors.js';
import type { ApproxLocation, OwnerToRelay, RelayToOwner } from './types.js';

const encoder = new TextEncoder();

function exceedsBytes(s: string, maxBytes: number): boolean {
  if (s.length > maxBytes) {
    return true;
  }
  return encoder.encode(s).length > maxBytes;
}

export function validateOwnerToRelay(x: unknown): OwnerToRelay | null {
  if (!isPlainObject(x)) {
    return null;
  }
  if (x.v !== 1 || typeof x.t !== 'string') {
    return null;
  }

  switch (x.t) {
    case 'approve': {
      if (!checkObjectKeys(x, ['v', 't', 'reqId', 'ownerPub', 'nonce', 'wrappedKey', 'mac2'])) {
        return null;
      }
      const reqId = x.reqId;
      const ownerPub = x.ownerPub;
      const nonce = x.nonce;
      const wrappedKey = x.wrappedKey;
      const mac2 = x.mac2;
      if (
        !isB16(reqId) ||
        !isB65(ownerPub) ||
        !isB12(nonce) ||
        !isB48(wrappedKey) ||
        !isB32(mac2)
      ) {
        return null;
      }
      return {
        v: 1,
        t: 'approve',
        reqId,
        ownerPub,
        nonce,
        wrappedKey,
        mac2,
      };
    }
    case 'deny': {
      if (!checkObjectKeys(x, ['v', 't', 'reqId'])) {
        return null;
      }
      const reqId = x.reqId;
      if (!isB16(reqId)) {
        return null;
      }
      return {
        v: 1,
        t: 'deny',
        reqId,
      };
    }
    case 'kill': {
      if (!checkObjectKeys(x, ['v', 't'])) {
        return null;
      }
      return {
        v: 1,
        t: 'kill',
      };
    }
    case 'hb': {
      if (!checkObjectKeys(x, ['v', 't', 'seq'])) {
        return null;
      }
      const seq = x.seq;
      if (!isSeq(seq)) {
        return null;
      }
      return {
        v: 1,
        t: 'hb',
        seq,
      };
    }
    default:
      return null;
  }
}

export function parseOwnerToRelay(frame: string): ParseResult<OwnerToRelay> {
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

  const msg = validateOwnerToRelay(raw);
  if (msg === null) {
    return { ok: false, code: 'BAD_MESSAGE' };
  }
  return { ok: true, msg };
}

export function serializeOwnerToRelay(m: OwnerToRelay, maxBytes: number = MAX_FRAME_BYTES): string {
  const valid = validateOwnerToRelay(m);
  if (valid === null) {
    throw new ProtocolError('BAD_MESSAGE');
  }
  const json = JSON.stringify(valid);
  if (exceedsBytes(json, maxBytes)) {
    throw new ProtocolError('TOO_LARGE');
  }
  return json;
}

export function validateRelayToOwner(x: unknown): RelayToOwner | null {
  if (!isPlainObject(x)) {
    return null;
  }
  if (x.v !== 1 || typeof x.t !== 'string') {
    return null;
  }

  switch (x.t) {
    case 'request': {
      if (
        !checkObjectKeys(x, ['v', 't', 'reqId', 'shopPub', 'mac', 'ua', 'approxLocation', 'at'])
      ) {
        return null;
      }
      const reqId = x.reqId;
      const shopPub = x.shopPub;
      const mac = x.mac;
      const ua = x.ua;
      const at = x.at;
      if (!isB16(reqId) || !isB65(shopPub) || !isB32(mac) || !isUa(ua, 2) || !isEpochMs(at)) {
        return null;
      }

      let parsedLocation: ApproxLocation | null = null;
      if (x.approxLocation === null) {
        parsedLocation = null;
      } else if (isPlainObject(x.approxLocation)) {
        const loc = x.approxLocation;
        if (!checkObjectKeys(loc, [], ['country', 'region'])) {
          return null;
        }
        let country: string | undefined = undefined;
        let region: string | undefined = undefined;
        if (Object.prototype.hasOwnProperty.call(loc, 'country')) {
          const locCountry = loc.country;
          if (locCountry === null || !isCountryCode(locCountry)) {
            return null;
          }
          country = locCountry;
        }
        if (Object.prototype.hasOwnProperty.call(loc, 'region')) {
          const locRegion = loc.region;
          if (locRegion === null || !isRegion(locRegion)) {
            return null;
          }
          region = locRegion;
        }
        const buildLoc: { country?: string; region?: string } = {};
        if (country !== undefined) {
          buildLoc.country = country;
        }
        if (region !== undefined) {
          buildLoc.region = region;
        }
        parsedLocation = buildLoc;
      } else {
        return null;
      }

      return {
        v: 1,
        t: 'request',
        reqId,
        shopPub,
        mac,
        ua: { browser: ua.browser, os: ua.os },
        approxLocation: parsedLocation,
        at,
      };
    }
    case 'status': {
      if (
        !checkObjectKeys(x, [
          'v',
          't',
          'state',
          'shopSeen',
          'lastHbMs',
          'printsDone',
          'remainingMs',
          'pending',
        ])
      ) {
        return null;
      }
      const state = x.state;
      const shopSeen = x.shopSeen;
      const lastHbMs = x.lastHbMs;
      const printsDone = x.printsDone;
      const remainingMs = x.remainingMs;
      const pending = x.pending;
      if (
        !isSessionState(state) ||
        typeof shopSeen !== 'boolean' ||
        (lastHbMs !== null && !isMillis(lastHbMs)) ||
        !isCount(printsDone) ||
        (remainingMs !== null && !isMillis(remainingMs)) ||
        !isCount(pending)
      ) {
        return null;
      }
      return {
        v: 1,
        t: 'status',
        state,
        shopSeen,
        lastHbMs,
        printsDone,
        remainingMs,
        pending,
      };
    }
    case 'destroyed': {
      if (!checkObjectKeys(x, ['v', 't', 'reason', 'at', 'printsDone', 'shopReportedWipe'])) {
        return null;
      }
      const reason = x.reason;
      const at = x.at;
      const printsDone = x.printsDone;
      const shopReportedWipe = x.shopReportedWipe;
      if (
        !isTerminalReason(reason) ||
        !isEpochMs(at) ||
        !isCount(printsDone) ||
        typeof shopReportedWipe !== 'boolean'
      ) {
        return null;
      }
      return {
        v: 1,
        t: 'destroyed',
        reason,
        at,
        printsDone,
        shopReportedWipe,
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

export function parseRelayToOwner(frame: string): ParseResult<RelayToOwner> {
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

  const msg = validateRelayToOwner(raw);
  if (msg === null) {
    return { ok: false, code: 'BAD_MESSAGE' };
  }
  return { ok: true, msg };
}

export function serializeRelayToOwner(m: RelayToOwner, maxBytes: number = MAX_FRAME_BYTES): string {
  const valid = validateRelayToOwner(m);
  if (valid === null) {
    throw new ProtocolError('BAD_MESSAGE');
  }
  const json = JSON.stringify(valid);
  if (exceedsBytes(json, maxBytes)) {
    throw new ProtocolError('TOO_LARGE');
  }
  return json;
}
