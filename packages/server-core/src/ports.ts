/** Ports: everything the relay needs from its host platform. */
import type { CreateSessionResponse } from '@despawn/protocol';

export interface BlobStore {
  put(id: string, data: Uint8Array): Promise<void>;
  get(id: string): Promise<Uint8Array | null>;
  delete(id: string): Promise<void>;
}

export interface TimerHandle {
  cancel(): void;
}

export interface Scheduler {
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
}

/** A connected WebSocket as seen by the relay. The adapter forwards inbound events to the handler. */
export interface RelaySocket {
  send(text: string): void;
  close(): void;
  readonly isOpen: boolean;
}

export interface SocketHandler {
  onMessage(text: string): void;
  onClose(): void;
}

export interface Logger {
  /** Structured, content-free events. Never pass keys, tokens, file names or payloads. */
  event(name: string, fields?: Record<string, string | number | boolean>): void;
}

export interface RelayConfig {
  readonly maxBlobBytes: number;
  readonly maxSessionsPerDay: number;
  readonly maxActiveSessions: number;
  /** Optional abuse challenge hook for POST /v1/sessions (Turnstile, proof of work, ...). */
  readonly verifyChallenge?: (token: string | undefined) => Promise<boolean>;
}

export interface HttpResult {
  readonly status: number;
  readonly json?: unknown;
}

export interface BlobResult {
  readonly status: number;
  readonly body?: Uint8Array;
}

export interface ShopMeta {
  readonly approxCountry?: string;
}

export type CreateResult =
  | { readonly status: 201; readonly json: CreateSessionResponse }
  | { readonly status: number; readonly json: { error: string } };
