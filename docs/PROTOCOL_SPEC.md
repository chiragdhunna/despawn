# Despawn: Protocol specification (v1), wire formats

Status: **normative**. This makes `docs/ARCHITECTURE.md` sections 4.2, 8.2 and 8.3 byte-exact. Where they differ, this document wins. The session **state machine** (transitions and effects) is specified separately in Task 3. This document only defines the state **names**, the messages, the limits and the validators.

Examples: [`protocol-examples.json`](protocol-examples.json). Every example must parse successfully with the matching parser.

## 1. Conventions

- WebSocket messages are **one JSON object per text frame**, UTF-8. HTTP bodies are JSON unless noted.
- Field names are camelCase. Every WebSocket message has `v` (the number `1`) and `t` (a string type tag).
- **Binary fields** are base64url without padding, decoded strictly with `base64urlDecode` from `@despawn/crypto`, and the decoded length must match exactly. A failure to decode or a wrong length is `BAD_MESSAGE`.
- **Strict objects:** a message must contain exactly the listed fields. A missing required field, an unknown field, or a wrong type is invalid. This includes the keys `__proto__`, `constructor` and `prototype`, which are never allowed anywhere.
- **Integers** must be JSON numbers that satisfy `Number.isSafeInteger` and lie in the stated range. Floats, `NaN`, strings and booleans are invalid.
- **Frame limit:** a text frame longer than `MAX_FRAME_BYTES` (UTF-8 bytes, measured before parsing) is rejected with `TOO_LARGE` without parsing.
- **Nesting:** at most 3 levels of objects. Arrays are not used anywhere in v1 and are invalid.
- **Text fields** (`ShortText`, `Region`, `purposeLabel`, `challengeToken`) must not contain control characters (U+0000 to U+001F, U+007F) and must have a length within the stated limits (counted in UTF-16 code units).
- **Parsers never throw.** For any input string they return a result object. Serializers validate and throw `ProtocolError` on invalid input.

## 2. Primitive types

| Name | Definition |
|---|---|
| `B16` | base64url of exactly 16 bytes (22 characters) |
| `B12` | base64url of exactly 12 bytes |
| `B32` | base64url of exactly 32 bytes (43 characters) |
| `B48` | base64url of exactly 48 bytes |
| `B65` | base64url of exactly 65 bytes whose first byte is `0x04` |
| `SessionId`, `ReqId`, `VerifyId` | `B16` |
| `Token32` | `B32` (owner token, blob token) |
| `EpochMs` | integer 0 to 4102444800000 |
| `Seq` | integer 0 to 2147483647 |
| `Count` | integer 0 to 1000 |
| `Millis` | integer 0 to 86400000 |
| `ShortText` | string, 1 to 40 characters |
| `Region` | string, 1 to 60 characters |
| `CountryCode` | two characters `A` to `Z` |
| `Ua` | object `{ browser: ShortText, os: ShortText }` |

## 3. Enumerations

| Name | Values |
|---|---|
| `SessionState` | `CREATED`, `ARMED`, `AWAITING`, `RELEASED`, `LIVE`, `DESTROYED`, `EXPIRED`, `CANCELLED`, `ABORTED` |
| Terminal states | `DESTROYED`, `EXPIRED`, `CANCELLED`, `ABORTED` |
| `TerminalReason` | `PRINTED`, `OWNER_KILLED`, `LIVE_TIMEOUT`, `HEARTBEAT_LOST`, `LINK_EXPIRED`, `CANCELLED`, `SHOP_WIPED`, `RELEASE_TIMEOUT` |
| `ShopViewState` | `WAITING`, `DECRYPTING`, `READY`, `PRINTING`, `WIPED` |
| `ShopWipeReason` | `PRINTED`, `KILLED`, `EXPIRED`, `ERROR`, `OFFLINE`, `USER_CLOSED` |
| `ErrorCode` | `BAD_MESSAGE`, `TOO_LARGE`, `WRONG_STATE`, `RATE_LIMITED`, `TOO_MANY_REQUESTS`, `NOT_FOUND`, `FORBIDDEN`, `UNAVAILABLE` |
| `VerifyStatus` | `VALID`, `REVOKED`, `EXPIRED` |

Refinement of ARCHITECTURE.md section 4.1: the diagram's `OPENED` state is removed (opening the link moves a session straight to `AWAITING`), `CREATED` is added (session exists, ciphertext not yet uploaded), and `DRAFT` is client-only and is not a protocol state. Task 3 updates the diagram.

## 4. WebSocket messages

Every message also carries `v: 1` and `t`. Fields listed are in addition to those.

### 4.1 Shop to relay

| `t` | Fields |
|---|---|
| `hello` | `shopPub: B65`, `mac: B32`, `ua: Ua` |
| `hb` | `seq: Seq`, `state: ShopViewState` |
| `rendered` | `pageCount`: integer 1 to `MAX_PAGES` |
| `printStarted` | none |
| `printed` | none |
| `wiped` | `reason: ShopWipeReason` |

### 4.2 Relay to shop

| `t` | Fields |
|---|---|
| `released` | `ownerPub: B65`, `nonce: B12`, `wrappedKey: B48`, `mac2: B32`, `blobToken: Token32`, `limits: { liveTtlMs, printLimit, destroyAfterPrint, graceMs }` (ranges in section 6) |
| `denied` | none |
| `tick` | `ownerAlive: boolean`, `remainingMs: Millis or null` |
| `kill` | `reason: TerminalReason` |
| `error` | `code: ErrorCode` |

### 4.3 Owner to relay

| `t` | Fields |
|---|---|
| `approve` | `reqId: ReqId`, `ownerPub: B65`, `nonce: B12`, `wrappedKey: B48`, `mac2: B32` |
| `deny` | `reqId: ReqId` |
| `kill` | none |
| `hb` | `seq: Seq` |

### 4.4 Relay to owner

| `t` | Fields |
|---|---|
| `request` | `reqId: ReqId`, `shopPub: B65`, `mac: B32`, `ua: Ua`, `approxLocation: null or { country?: CountryCode, region?: Region }`, `at: EpochMs` |
| `status` | `state: SessionState`, `shopSeen: boolean`, `lastHbMs: Millis or null`, `printsDone: Count`, `remainingMs: Millis or null`, `pending: Count` |
| `destroyed` | `reason: TerminalReason`, `at: EpochMs`, `printsDone: Count`, `shopReportedWipe: boolean` |
| `error` | `code: ErrorCode` |

`approxLocation` fields are optional individually. An empty object `{}` is valid. A field may not be present with the value `null`.

The architecture table calls the wrapped key `wrappedK`. In the wire protocol, and everywhere else, the name is **`wrappedKey`**.

## 5. HTTP shapes

| Endpoint | Request | Response |
|---|---|---|
| `POST /v1/sessions` | JSON `CreateSessionRequest` | `201` JSON `CreateSessionResponse` |
| `PUT /v1/sessions/:id/blob` | raw bytes, `Content-Length` at most `MAX_BLOB_BYTES` | `204` |
| `GET /v1/sessions/:id/blob?t=<Token32>` | none | `200` raw bytes |
| `DELETE /v1/sessions/:id` | none | `204` |
| `GET /v1/verify/:verifyId` | none | `200` JSON `VerifyResponse`, or `404` `ErrorResponse` |
| any error | none | JSON `ErrorResponse` |

**`CreateSessionRequest`:** `linkTtlMs`, `liveTtlMs`, `printLimit`, `destroyAfterPrint: boolean`, `graceMs`, `blobBytes`: integer 1 to `MAX_BLOB_BYTES`, `verifyEnabled: boolean`, and optional `challengeToken`: string, 1 to 2048 characters, no control characters.

**`CreateSessionResponse`:** `sessionId: SessionId`, `ownerToken: Token32`, `limits: ServerLimits`.

**`ServerLimits`:** `maxBlobBytes`, `maxPages`, `maxFrameBytes`, `maxPendingRequests` (all positive integers).

**`VerifyResponse`:** `status: VerifyStatus`, `purposeLabel`: string, 0 to 60 characters, no control characters, `issuedAt: EpochMs`.

**`ErrorResponse`:** `{ error: ErrorCode }`.

Path and query parameters are validated with the same primitive rules (`SessionId`, `Token32`, `VerifyId`). Export `isSessionId`, `isToken32`, `isVerifyId` for this.

## 6. Constants and rule ranges

| Constant | Value |
|---|---|
| `PROTOCOL_VERSION` | 1 |
| `MAX_FRAME_BYTES` | 4096 |
| `MAX_PAGES` | 50 |
| `MAX_BLOB_BYTES` | 26214400 (25 MiB) |
| `MAX_PENDING_REQUESTS` | 4 |
| `HEARTBEAT_INTERVAL_MS` | 2000 |
| `HEARTBEAT_TIMEOUT_MS` | 10000 |
| `RELEASE_TIMEOUT_MS` | 60000 (shop must report `rendered` within this time after `released`) |
| `UPLOAD_TIMEOUT_MS` | 600000 (ciphertext must be uploaded within this time after session creation) |
| `BLOB_TOKEN_TTL_MS` | 60000 |
| `SAS_DIGITS` | 4 |

| Rule | Default | Min | Max |
|---|---|---|---|
| `linkTtlMs` | 1800000 | 300000 | 86400000 |
| `liveTtlMs` | 120000 | 30000 | 600000 |
| `printLimit` | 1 | 1 | 10 |
| `graceMs` | 10000 | 0 | 60000 |

Export these as typed constants, with `DEFAULT_RULES` (`destroyAfterPrint: true`) and a `validateRules(x)` function that returns a result object and checks types and ranges.

## 7. Required exports of `@despawn/protocol`

Keep the existing `export const VERSION = '0.0.0'` so existing code and tests keep working.

```ts
export const PROTOCOL_VERSION = 1;
// constants from section 6, plus the enumerations from section 3 as readonly arrays and union types
export function isTerminalState(s: SessionState): boolean;

export class ProtocolError extends Error { readonly code: 'BAD_MESSAGE' | 'TOO_LARGE'; }
export type ParseResult<T> = { ok: true; msg: T } | { ok: false; code: 'BAD_MESSAGE' | 'TOO_LARGE' };

// one parser and one serializer per direction (types are discriminated unions on `t`)
export function parseShopToRelay(frame: string): ParseResult<ShopToRelay>;
export function parseRelayToShop(frame: string): ParseResult<RelayToShop>;
export function parseOwnerToRelay(frame: string): ParseResult<OwnerToRelay>;
export function parseRelayToOwner(frame: string): ParseResult<RelayToOwner>;
export function serializeShopToRelay(m: ShopToRelay): string;   // validates, enforces frame size, throws ProtocolError
export function serializeRelayToShop(m: RelayToShop): string;
export function serializeOwnerToRelay(m: OwnerToRelay): string;
export function serializeRelayToOwner(m: RelayToOwner): string;

// HTTP shapes
export function parseCreateSessionRequest(x: unknown): ParseResult<CreateSessionRequest>;
export function parseCreateSessionResponse(x: unknown): ParseResult<CreateSessionResponse>;
export function parseVerifyResponse(x: unknown): ParseResult<VerifyResponse>;
export function parseErrorResponse(x: unknown): ParseResult<ErrorResponse>;
export function validateRules(x: unknown): ParseResult<Rules>;
export function isSessionId(s: unknown): s is string;
export function isToken32(s: unknown): s is string;
export function isVerifyId(s: unknown): s is string;
```

All message and shape types are exported. The package has **no runtime dependencies other than `@despawn/crypto`** (workspace, used only for `base64urlDecode`). It must be tree-shakeable: set `"sideEffects": false` in its `package.json`, and use no top-level side effects. The shop viewer imports only `parseRelayToShop` and `serializeShopToRelay`, so unused parsers must not be pulled into its bundle.

Use a small internal declarative validator (a few helper functions that build checkers for strict objects, enums, integers, text and binary fields), not a schema library. This keeps the shop viewer small and ES2018-safe and keeps the attack surface auditable.

## 8. Required tests

Load examples from `docs/protocol-examples.json`.

1. **Examples:** every example parses with its direction's parser and the result deep-equals the example. `serialize` followed by `parse` returns an equal object for every example.
2. **Direction isolation:** every shop-to-relay example fails to parse with the owner-to-relay and relay parsers, and so on for each direction. Where two directions share a `t` (`hb`, `kill`, `error`), the field differences must make the wrong-direction parse fail (for example, shop `hb` has `state`, owner `hb` does not).
3. **Per-field negatives:** for every field of every message: missing, wrong type, `null` where not allowed, and out of range or wrong length where applicable. Generate these from the examples programmatically, not by hand.
4. **Binary fields:** non-canonical base64url, padding, wrong decoded length, and for `B65` a first byte other than `0x04` are all rejected.
5. **Strictness:** an extra field, a `__proto__` key, a `constructor` key, an array at the top level, `null`, a number, a string, and an empty string are all rejected. `v` of `2`, `"1"` or missing is rejected.
6. **Size:** a frame of `MAX_FRAME_BYTES + 1` UTF-8 bytes (including a frame whose character count is below the limit but whose byte count is above it, using multi-byte characters) returns `TOO_LARGE`. A frame of exactly `MAX_FRAME_BYTES` bytes is accepted only if it is otherwise valid.
7. **Text:** control characters (U+0000, U+001F, U+007F) in `ShortText`, `Region`, `purposeLabel` and `challengeToken` are rejected. Length 0 and length max+1 are rejected for the types that have a minimum of 1.
8. **Integers:** `NaN`, `Infinity`, `-1`, `1.5`, `"5"`, `2 ** 53` and out-of-range values are rejected for every integer field. Boundary values (min and max) are accepted.
9. **Enumerations:** every valid value is accepted. A lowercase or unknown value is rejected, for every enumerated field.
10. **Rules:** `DEFAULT_RULES` is valid. Each rule's min and max are accepted and min-1 and max+1 are rejected. `min <= default <= max` for every rule. `printLimit` 0 and 11 are rejected.
11. **HTTP shapes:** the examples parse. Negatives per field as in item 3. `isSessionId`, `isToken32` and `isVerifyId` accept the examples and reject wrong lengths and bad alphabets.
12. **Never throws (fuzz):** with a seeded pseudo-random generator written in the test (no dependency), feed each parser at least 5000 inputs: random strings, random bytes decoded as text, valid examples with random single-character mutations, truncated examples, and examples with random fields deleted or duplicated. No call may throw, and each returns a result object. Any `ok: true` result for a mutated input must also pass a second, independent check: re-serialize it and confirm it round-trips. Print the seed on failure.
13. **Serializers:** an invalid message passed to a serializer throws `ProtocolError`. A valid message larger than `MAX_FRAME_BYTES` throws `ProtocolError` with code `TOO_LARGE`.
14. **Tree-shaking:** build a tiny entry that imports only `parseRelayToShop` and `serializeShopToRelay`, bundle it minified for ES2018, and report its gzip size in the progress report. The bundle must not contain the strings `parseOwnerToRelay` or `approxLocation`.

## 9. Not in this package

The session state machine reducer, timers, server, storage, networking, UI and the print bundle format belong to other tasks.
