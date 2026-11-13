export const SESSION_STATES = Object.freeze([
  'CREATED',
  'ARMED',
  'AWAITING',
  'RELEASED',
  'LIVE',
  'DESTROYED',
  'EXPIRED',
  'CANCELLED',
  'ABORTED',
] as const);
export type SessionState = (typeof SESSION_STATES)[number];

export const TERMINAL_STATES = Object.freeze([
  'DESTROYED',
  'EXPIRED',
  'CANCELLED',
  'ABORTED',
] as const);
export type TerminalState = (typeof TERMINAL_STATES)[number];

export const TERMINAL_REASONS = Object.freeze([
  'PRINTED',
  'OWNER_KILLED',
  'LIVE_TIMEOUT',
  'HEARTBEAT_LOST',
  'LINK_EXPIRED',
  'CANCELLED',
  'SHOP_WIPED',
  'RELEASE_TIMEOUT',
] as const);
export type TerminalReason = (typeof TERMINAL_REASONS)[number];

export const SHOP_VIEW_STATES = Object.freeze([
  'WAITING',
  'DECRYPTING',
  'READY',
  'PRINTING',
  'WIPED',
] as const);
export type ShopViewState = (typeof SHOP_VIEW_STATES)[number];

export const SHOP_WIPE_REASONS = Object.freeze([
  'PRINTED',
  'KILLED',
  'EXPIRED',
  'ERROR',
  'OFFLINE',
  'USER_CLOSED',
] as const);
export type ShopWipeReason = (typeof SHOP_WIPE_REASONS)[number];

export const ERROR_CODES = Object.freeze([
  'BAD_MESSAGE',
  'TOO_LARGE',
  'WRONG_STATE',
  'RATE_LIMITED',
  'TOO_MANY_REQUESTS',
  'NOT_FOUND',
  'FORBIDDEN',
  'UNAVAILABLE',
] as const);
export type ErrorCode = (typeof ERROR_CODES)[number];

export const VERIFY_STATUSES = Object.freeze(['VALID', 'REVOKED', 'EXPIRED'] as const);
export type VerifyStatus = (typeof VERIFY_STATUSES)[number];

export function isTerminalState(s: SessionState): boolean {
  return s === 'DESTROYED' || s === 'EXPIRED' || s === 'CANCELLED' || s === 'ABORTED';
}

export function isSessionState(x: unknown): x is SessionState {
  return (
    typeof x === 'string' &&
    (x === 'CREATED' ||
      x === 'ARMED' ||
      x === 'AWAITING' ||
      x === 'RELEASED' ||
      x === 'LIVE' ||
      x === 'DESTROYED' ||
      x === 'EXPIRED' ||
      x === 'CANCELLED' ||
      x === 'ABORTED')
  );
}

export function isTerminalReason(x: unknown): x is TerminalReason {
  return (
    typeof x === 'string' &&
    (x === 'PRINTED' ||
      x === 'OWNER_KILLED' ||
      x === 'LIVE_TIMEOUT' ||
      x === 'HEARTBEAT_LOST' ||
      x === 'LINK_EXPIRED' ||
      x === 'CANCELLED' ||
      x === 'SHOP_WIPED' ||
      x === 'RELEASE_TIMEOUT')
  );
}

export function isShopViewState(x: unknown): x is ShopViewState {
  return (
    typeof x === 'string' &&
    (x === 'WAITING' || x === 'DECRYPTING' || x === 'READY' || x === 'PRINTING' || x === 'WIPED')
  );
}

export function isShopWipeReason(x: unknown): x is ShopWipeReason {
  return (
    typeof x === 'string' &&
    (x === 'PRINTED' ||
      x === 'KILLED' ||
      x === 'EXPIRED' ||
      x === 'ERROR' ||
      x === 'OFFLINE' ||
      x === 'USER_CLOSED')
  );
}

export function isErrorCode(x: unknown): x is ErrorCode {
  return (
    typeof x === 'string' &&
    (x === 'BAD_MESSAGE' ||
      x === 'TOO_LARGE' ||
      x === 'WRONG_STATE' ||
      x === 'RATE_LIMITED' ||
      x === 'TOO_MANY_REQUESTS' ||
      x === 'NOT_FOUND' ||
      x === 'FORBIDDEN' ||
      x === 'UNAVAILABLE')
  );
}

export function isVerifyStatus(x: unknown): x is VerifyStatus {
  return typeof x === 'string' && (x === 'VALID' || x === 'REVOKED' || x === 'EXPIRED');
}
