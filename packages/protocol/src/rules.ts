import { checkObjectKeys, isIntegerInRange, isPlainObject } from './check.js';
import {
  DEFAULT_GRACE_MS,
  DEFAULT_LINK_TTL_MS,
  DEFAULT_LIVE_TTL_MS,
  DEFAULT_PRINT_LIMIT,
  MAX_GRACE_MS,
  MAX_LINK_TTL_MS,
  MAX_LIVE_TTL_MS,
  MAX_PRINT_LIMIT,
  MIN_GRACE_MS,
  MIN_LINK_TTL_MS,
  MIN_LIVE_TTL_MS,
  MIN_PRINT_LIMIT,
} from './constants.js';
import type { ParseResult } from './errors.js';
import type { Rules } from './types.js';

export const DEFAULT_RULES: Rules = Object.freeze({
  linkTtlMs: DEFAULT_LINK_TTL_MS,
  liveTtlMs: DEFAULT_LIVE_TTL_MS,
  printLimit: DEFAULT_PRINT_LIMIT,
  destroyAfterPrint: true,
  graceMs: DEFAULT_GRACE_MS,
});

export function validateRules(x: unknown): ParseResult<Rules> {
  if (!isPlainObject(x)) {
    return { ok: false, code: 'BAD_MESSAGE' };
  }
  if (
    !checkObjectKeys(x, ['linkTtlMs', 'liveTtlMs', 'printLimit', 'destroyAfterPrint', 'graceMs'])
  ) {
    return { ok: false, code: 'BAD_MESSAGE' };
  }

  if (
    !isIntegerInRange(x.linkTtlMs, MIN_LINK_TTL_MS, MAX_LINK_TTL_MS) ||
    !isIntegerInRange(x.liveTtlMs, MIN_LIVE_TTL_MS, MAX_LIVE_TTL_MS) ||
    !isIntegerInRange(x.printLimit, MIN_PRINT_LIMIT, MAX_PRINT_LIMIT) ||
    typeof x.destroyAfterPrint !== 'boolean' ||
    !isIntegerInRange(x.graceMs, MIN_GRACE_MS, MAX_GRACE_MS)
  ) {
    return { ok: false, code: 'BAD_MESSAGE' };
  }

  return {
    ok: true,
    msg: {
      linkTtlMs: x.linkTtlMs,
      liveTtlMs: x.liveTtlMs,
      printLimit: x.printLimit,
      destroyAfterPrint: x.destroyAfterPrint,
      graceMs: x.graceMs,
    },
  };
}
