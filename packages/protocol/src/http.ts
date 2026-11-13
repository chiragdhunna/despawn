import {
  checkObjectKeys,
  isB16,
  isB32,
  isChallengeToken,
  isEpochMs,
  isIntegerInRange,
  isPlainObject,
  isPurposeLabel,
} from './check.js';
import {
  MAX_BLOB_BYTES,
  MAX_GRACE_MS,
  MAX_LINK_TTL_MS,
  MAX_LIVE_TTL_MS,
  MAX_PRINT_LIMIT,
  MIN_GRACE_MS,
  MIN_LINK_TTL_MS,
  MIN_LIVE_TTL_MS,
  MIN_PRINT_LIMIT,
} from './constants.js';
import { isErrorCode, isVerifyStatus } from './enums.js';
import type { ParseResult } from './errors.js';
import type {
  CreateSessionRequest,
  CreateSessionResponse,
  ErrorResponse,
  ServerLimits,
  VerifyResponse,
} from './types.js';

export function isSessionId(s: unknown): s is string {
  return isB16(s);
}

export function isToken32(s: unknown): s is string {
  return isB32(s);
}

export function isVerifyId(s: unknown): s is string {
  return isB16(s);
}

export function parseCreateSessionRequest(x: unknown): ParseResult<CreateSessionRequest> {
  if (!isPlainObject(x)) {
    return { ok: false, code: 'BAD_MESSAGE' };
  }
  if (
    !checkObjectKeys(
      x,
      [
        'linkTtlMs',
        'liveTtlMs',
        'printLimit',
        'destroyAfterPrint',
        'graceMs',
        'blobBytes',
        'verifyEnabled',
      ],
      ['challengeToken'],
    )
  ) {
    return { ok: false, code: 'BAD_MESSAGE' };
  }

  const linkTtlMs = x.linkTtlMs;
  const liveTtlMs = x.liveTtlMs;
  const printLimit = x.printLimit;
  const destroyAfterPrint = x.destroyAfterPrint;
  const graceMs = x.graceMs;
  const blobBytes = x.blobBytes;
  const verifyEnabled = x.verifyEnabled;

  if (
    !isIntegerInRange(linkTtlMs, MIN_LINK_TTL_MS, MAX_LINK_TTL_MS) ||
    !isIntegerInRange(liveTtlMs, MIN_LIVE_TTL_MS, MAX_LIVE_TTL_MS) ||
    !isIntegerInRange(printLimit, MIN_PRINT_LIMIT, MAX_PRINT_LIMIT) ||
    typeof destroyAfterPrint !== 'boolean' ||
    !isIntegerInRange(graceMs, MIN_GRACE_MS, MAX_GRACE_MS) ||
    !isIntegerInRange(blobBytes, 1, MAX_BLOB_BYTES) ||
    typeof verifyEnabled !== 'boolean'
  ) {
    return { ok: false, code: 'BAD_MESSAGE' };
  }

  let challengeToken: string | undefined = undefined;
  if (Object.prototype.hasOwnProperty.call(x, 'challengeToken')) {
    const token = x.challengeToken;
    if (token === null || !isChallengeToken(token)) {
      return { ok: false, code: 'BAD_MESSAGE' };
    }
    challengeToken = token;
  }

  const req: CreateSessionRequest = {
    linkTtlMs,
    liveTtlMs,
    printLimit,
    destroyAfterPrint,
    graceMs,
    blobBytes,
    verifyEnabled,
    ...(challengeToken !== undefined ? { challengeToken } : {}),
  };

  return { ok: true, msg: req };
}

export function parseCreateSessionResponse(x: unknown): ParseResult<CreateSessionResponse> {
  if (!isPlainObject(x)) {
    return { ok: false, code: 'BAD_MESSAGE' };
  }
  if (!checkObjectKeys(x, ['sessionId', 'ownerToken', 'limits'])) {
    return { ok: false, code: 'BAD_MESSAGE' };
  }
  const sessionId = x.sessionId;
  const ownerToken = x.ownerToken;
  if (!isSessionId(sessionId) || !isToken32(ownerToken)) {
    return { ok: false, code: 'BAD_MESSAGE' };
  }

  if (!isPlainObject(x.limits)) {
    return { ok: false, code: 'BAD_MESSAGE' };
  }
  const limits = x.limits;
  if (
    !checkObjectKeys(limits, ['maxBlobBytes', 'maxPages', 'maxFrameBytes', 'maxPendingRequests'])
  ) {
    return { ok: false, code: 'BAD_MESSAGE' };
  }

  const maxBlobBytes = limits.maxBlobBytes;
  const maxPages = limits.maxPages;
  const maxFrameBytes = limits.maxFrameBytes;
  const maxPendingRequests = limits.maxPendingRequests;

  if (
    !isIntegerInRange(maxBlobBytes, 1, Number.MAX_SAFE_INTEGER) ||
    !isIntegerInRange(maxPages, 1, Number.MAX_SAFE_INTEGER) ||
    !isIntegerInRange(maxFrameBytes, 1, Number.MAX_SAFE_INTEGER) ||
    !isIntegerInRange(maxPendingRequests, 1, Number.MAX_SAFE_INTEGER)
  ) {
    return { ok: false, code: 'BAD_MESSAGE' };
  }

  const parsedLimits: ServerLimits = {
    maxBlobBytes,
    maxPages,
    maxFrameBytes,
    maxPendingRequests,
  };

  return {
    ok: true,
    msg: {
      sessionId,
      ownerToken,
      limits: parsedLimits,
    },
  };
}

export function parseVerifyResponse(x: unknown): ParseResult<VerifyResponse> {
  if (!isPlainObject(x)) {
    return { ok: false, code: 'BAD_MESSAGE' };
  }
  if (!checkObjectKeys(x, ['status', 'purposeLabel', 'issuedAt'])) {
    return { ok: false, code: 'BAD_MESSAGE' };
  }
  const status = x.status;
  const purposeLabel = x.purposeLabel;
  const issuedAt = x.issuedAt;

  if (!isVerifyStatus(status) || !isPurposeLabel(purposeLabel) || !isEpochMs(issuedAt)) {
    return { ok: false, code: 'BAD_MESSAGE' };
  }

  return {
    ok: true,
    msg: {
      status,
      purposeLabel,
      issuedAt,
    },
  };
}

export function parseErrorResponse(x: unknown): ParseResult<ErrorResponse> {
  if (!isPlainObject(x)) {
    return { ok: false, code: 'BAD_MESSAGE' };
  }
  if (!checkObjectKeys(x, ['error'])) {
    return { ok: false, code: 'BAD_MESSAGE' };
  }
  const error = x.error;
  if (!isErrorCode(error)) {
    return { ok: false, code: 'BAD_MESSAGE' };
  }

  return {
    ok: true,
    msg: {
      error,
    },
  };
}
