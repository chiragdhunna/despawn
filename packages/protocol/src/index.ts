export const VERSION = '0.0.0';

export {
  PROTOCOL_VERSION,
  MAX_FRAME_BYTES,
  MAX_PAGES,
  MAX_BLOB_BYTES,
  MAX_PENDING_REQUESTS,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  RELEASE_TIMEOUT_MS,
  UPLOAD_TIMEOUT_MS,
  BLOB_TOKEN_TTL_MS,
  SAS_DIGITS,
  DEFAULT_LINK_TTL_MS,
  MIN_LINK_TTL_MS,
  MAX_LINK_TTL_MS,
  DEFAULT_LIVE_TTL_MS,
  MIN_LIVE_TTL_MS,
  MAX_LIVE_TTL_MS,
  DEFAULT_PRINT_LIMIT,
  MIN_PRINT_LIMIT,
  MAX_PRINT_LIMIT,
  DEFAULT_GRACE_MS,
  MIN_GRACE_MS,
  MAX_GRACE_MS,
  RULE_LIMITS,
} from './constants.js';

export {
  SESSION_STATES,
  type SessionState,
  TERMINAL_STATES,
  type TerminalState,
  TERMINAL_REASONS,
  type TerminalReason,
  SHOP_VIEW_STATES,
  type ShopViewState,
  SHOP_WIPE_REASONS,
  type ShopWipeReason,
  ERROR_CODES,
  type ErrorCode,
  VERIFY_STATUSES,
  type VerifyStatus,
  isTerminalState,
} from './enums.js';

export { ProtocolError, type ParseResult } from './errors.js';

export type {
  Ua,
  ApproxLocation,
  ShopToRelayHello,
  ShopToRelayHb,
  ShopToRelayRendered,
  ShopToRelayPrintStarted,
  ShopToRelayPrinted,
  ShopToRelayWiped,
  ShopToRelay,
  RelayToShopLimits,
  RelayToShopReleased,
  RelayToShopDenied,
  RelayToShopTick,
  RelayToShopKill,
  RelayToShopError,
  RelayToShop,
  OwnerToRelayApprove,
  OwnerToRelayDeny,
  OwnerToRelayKill,
  OwnerToRelayHb,
  OwnerToRelay,
  RelayToOwnerRequest,
  RelayToOwnerStatus,
  RelayToOwnerDestroyed,
  RelayToOwnerError,
  RelayToOwner,
  CreateSessionRequest,
  ServerLimits,
  CreateSessionResponse,
  VerifyResponse,
  ErrorResponse,
  Rules,
} from './types.js';

export {
  parseShopToRelay,
  serializeShopToRelay,
  parseRelayToShop,
  serializeRelayToShop,
} from './shop-relay.js';

export {
  parseOwnerToRelay,
  serializeOwnerToRelay,
  parseRelayToOwner,
  serializeRelayToOwner,
} from './owner-relay.js';

export { DEFAULT_RULES, validateRules } from './rules.js';

export {
  parseCreateSessionRequest,
  parseCreateSessionResponse,
  parseVerifyResponse,
  parseErrorResponse,
  isSessionId,
  isToken32,
  isVerifyId,
} from './http.js';
