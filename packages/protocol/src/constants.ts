export const PROTOCOL_VERSION = 1;
export const MAX_FRAME_BYTES = 4096;
export const MAX_PAGES = 50;
export const MAX_BLOB_BYTES = 26214400; // 25 MiB
export const MAX_PENDING_REQUESTS = 4;
export const HEARTBEAT_INTERVAL_MS = 2000;
export const HEARTBEAT_TIMEOUT_MS = 10000;
export const RELEASE_TIMEOUT_MS = 60000;
export const UPLOAD_TIMEOUT_MS = 600000;
export const BLOB_TOKEN_TTL_MS = 60000;
export const SAS_DIGITS = 4;

export const DEFAULT_LINK_TTL_MS = 1800000;
export const MIN_LINK_TTL_MS = 300000;
export const MAX_LINK_TTL_MS = 86400000;

export const DEFAULT_LIVE_TTL_MS = 120000;
export const MIN_LIVE_TTL_MS = 30000;
export const MAX_LIVE_TTL_MS = 600000;

export const DEFAULT_PRINT_LIMIT = 1;
export const MIN_PRINT_LIMIT = 1;
export const MAX_PRINT_LIMIT = 10;

export const DEFAULT_GRACE_MS = 10000;
export const MIN_GRACE_MS = 0;
export const MAX_GRACE_MS = 60000;

export const RULE_LIMITS = Object.freeze({
  linkTtlMs: Object.freeze({
    min: MIN_LINK_TTL_MS,
    max: MAX_LINK_TTL_MS,
    default: DEFAULT_LINK_TTL_MS,
  }),
  liveTtlMs: Object.freeze({
    min: MIN_LIVE_TTL_MS,
    max: MAX_LIVE_TTL_MS,
    default: DEFAULT_LIVE_TTL_MS,
  }),
  printLimit: Object.freeze({
    min: MIN_PRINT_LIMIT,
    max: MAX_PRINT_LIMIT,
    default: DEFAULT_PRINT_LIMIT,
  }),
  graceMs: Object.freeze({
    min: MIN_GRACE_MS,
    max: MAX_GRACE_MS,
    default: DEFAULT_GRACE_MS,
  }),
});
