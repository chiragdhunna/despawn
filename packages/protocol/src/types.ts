import type {
  ErrorCode,
  SessionState,
  ShopViewState,
  ShopWipeReason,
  TerminalReason,
  VerifyStatus,
} from './enums.js';

export interface Ua {
  readonly browser: string;
  readonly os: string;
}

export interface ApproxLocation {
  readonly country?: string;
  readonly region?: string;
}

// 4.1 Shop to relay
export interface ShopToRelayHello {
  readonly v: 1;
  readonly t: 'hello';
  readonly shopPub: string;
  readonly mac: string;
  readonly ua: Ua;
}

export interface ShopToRelayHb {
  readonly v: 1;
  readonly t: 'hb';
  readonly seq: number;
  readonly state: ShopViewState;
}

export interface ShopToRelayRendered {
  readonly v: 1;
  readonly t: 'rendered';
  readonly pageCount: number;
}

export interface ShopToRelayPrintStarted {
  readonly v: 1;
  readonly t: 'printStarted';
}

export interface ShopToRelayPrinted {
  readonly v: 1;
  readonly t: 'printed';
}

export interface ShopToRelayWiped {
  readonly v: 1;
  readonly t: 'wiped';
  readonly reason: ShopWipeReason;
}

export type ShopToRelay =
  | ShopToRelayHello
  | ShopToRelayHb
  | ShopToRelayRendered
  | ShopToRelayPrintStarted
  | ShopToRelayPrinted
  | ShopToRelayWiped;

// 4.2 Relay to shop
export interface RelayToShopLimits {
  readonly liveTtlMs: number;
  readonly printLimit: number;
  readonly destroyAfterPrint: boolean;
  readonly graceMs: number;
}

export interface RelayToShopReleased {
  readonly v: 1;
  readonly t: 'released';
  readonly ownerPub: string;
  readonly nonce: string;
  readonly wrappedKey: string;
  readonly mac2: string;
  readonly blobToken: string;
  readonly limits: RelayToShopLimits;
}

export interface RelayToShopDenied {
  readonly v: 1;
  readonly t: 'denied';
}

export interface RelayToShopTick {
  readonly v: 1;
  readonly t: 'tick';
  readonly ownerAlive: boolean;
  readonly remainingMs: number | null;
}

export interface RelayToShopKill {
  readonly v: 1;
  readonly t: 'kill';
  readonly reason: TerminalReason;
}

export interface RelayToShopError {
  readonly v: 1;
  readonly t: 'error';
  readonly code: ErrorCode;
}

export type RelayToShop =
  RelayToShopReleased | RelayToShopDenied | RelayToShopTick | RelayToShopKill | RelayToShopError;

// 4.3 Owner to relay
export interface OwnerToRelayApprove {
  readonly v: 1;
  readonly t: 'approve';
  readonly reqId: string;
  readonly ownerPub: string;
  readonly nonce: string;
  readonly wrappedKey: string;
  readonly mac2: string;
}

export interface OwnerToRelayDeny {
  readonly v: 1;
  readonly t: 'deny';
  readonly reqId: string;
}

export interface OwnerToRelayKill {
  readonly v: 1;
  readonly t: 'kill';
}

export interface OwnerToRelayHb {
  readonly v: 1;
  readonly t: 'hb';
  readonly seq: number;
}

export type OwnerToRelay =
  OwnerToRelayApprove | OwnerToRelayDeny | OwnerToRelayKill | OwnerToRelayHb;

// 4.4 Relay to owner
export interface RelayToOwnerRequest {
  readonly v: 1;
  readonly t: 'request';
  readonly reqId: string;
  readonly shopPub: string;
  readonly mac: string;
  readonly ua: Ua;
  readonly approxLocation: ApproxLocation | null;
  readonly at: number;
}

export interface RelayToOwnerStatus {
  readonly v: 1;
  readonly t: 'status';
  readonly state: SessionState;
  readonly shopSeen: boolean;
  readonly lastHbMs: number | null;
  readonly printsDone: number;
  readonly remainingMs: number | null;
  readonly pending: number;
}

export interface RelayToOwnerDestroyed {
  readonly v: 1;
  readonly t: 'destroyed';
  readonly reason: TerminalReason;
  readonly at: number;
  readonly printsDone: number;
  readonly shopReportedWipe: boolean;
}

export interface RelayToOwnerError {
  readonly v: 1;
  readonly t: 'error';
  readonly code: ErrorCode;
}

export type RelayToOwner =
  RelayToOwnerRequest | RelayToOwnerStatus | RelayToOwnerDestroyed | RelayToOwnerError;

// 5. HTTP shapes
export interface CreateSessionRequest {
  readonly linkTtlMs: number;
  readonly liveTtlMs: number;
  readonly printLimit: number;
  readonly destroyAfterPrint: boolean;
  readonly graceMs: number;
  readonly blobBytes: number;
  readonly verifyEnabled: boolean;
  readonly challengeToken?: string;
}

export interface ServerLimits {
  readonly maxBlobBytes: number;
  readonly maxPages: number;
  readonly maxFrameBytes: number;
  readonly maxPendingRequests: number;
}

export interface CreateSessionResponse {
  readonly sessionId: string;
  readonly ownerToken: string;
  readonly limits: ServerLimits;
}

export interface VerifyResponse {
  readonly status: VerifyStatus;
  readonly purposeLabel: string;
  readonly issuedAt: number;
}

export interface ErrorResponse {
  readonly error: ErrorCode;
}

export interface Rules {
  readonly linkTtlMs: number;
  readonly liveTtlMs: number;
  readonly printLimit: number;
  readonly destroyAfterPrint: boolean;
  readonly graceMs: number;
}
