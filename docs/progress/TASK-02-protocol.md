# TASK-02: packages/protocol (wire formats, validators, constants)

## Summary
Implemented `packages/protocol` according to normative specification `docs/PROTOCOL_SPEC.md` for Despawn v1 wire formats. Built dependency-free (with only `@despawn/crypto` for `base64urlDecode`) typed messages, strict validators, per-direction parsers and serializers, HTTP shape validators, constants, and rule bounds. All runtime code strictly targets ES2018 for compatibility with Chrome 109 and adheres to a tree-shakeable modular architecture ensuring the shop viewer subset does not pull in owner or location logic. An exhaustive test suite was authored covering all 14 verification requirements in `docs/PROTOCOL_SPEC.md` section 8, including programmatic per-field negative mutations, seeded fuzz testing across 20,000 iterations, serializer validation, and esbuild bundle tree-shaking verification. All checks passed from a clean state, three consecutive test runs passed cleanly, six mutation checks failed the expected tests and were reverted, and an AST check verified full ES2018 compliance.

## Changes
- `docs/PROTOCOL_SPEC.md`: Added protocol specification v1 defining wire formats, primitives, enums, limits, and required tests (committed unchanged).
- `docs/protocol-examples.json`: Added golden example payloads for all protocol directions and HTTP shapes (committed unchanged).
- `docs/ARCHITECTURE.md`: Aligned protocol wording (dependency-free validators), updated repo layout description, and replaced `wrappedK` with `wrappedKey` using regex `wrappedK(?!ey)`.
- `packages/protocol/package.json`: Added `@despawn/crypto` workspace dependency, `esbuild` devDependency, and set `"sideEffects": false`.
- `packages/protocol/tsconfig.json`: Configured strict ES2018 target, ES2018 and DOM libs, resolveJsonModule true, and empty types array.
- `pnpm-lock.yaml`: Updated lockfile with `@despawn/crypto` dependency link and `esbuild` devDependency.
- `packages/protocol/src/constants.ts`: Defined protocol limits, timeouts, intervals, and rule bounds (`PROTOCOL_VERSION`, `MAX_FRAME_BYTES`, `RULE_LIMITS`, etc.).
- `packages/protocol/src/enums.ts`: Exported readonly arrays and union types for `SessionState`, `TerminalReason`, `ShopViewState`, `ShopWipeReason`, `ErrorCode`, `VerifyStatus`, and type guards including `isTerminalState`.
- `packages/protocol/src/errors.ts`: Implemented `ProtocolError` with codes `BAD_MESSAGE` and `TOO_LARGE`, and exported `ParseResult<T>`.
- `packages/protocol/src/types.ts`: Exported strict TypeScript types for all WebSocket messages, HTTP payloads, and primitive structures.
- `packages/protocol/src/check.ts`: Implemented helper validators for strict objects, control character rejection, integer ranges, text length limits, and binary decoding (`isB12`, `isB16`, `isB32`, `isB48`, `isB65`).
- `packages/protocol/src/shop-relay.ts`: Implemented `parseShopToRelay`, `serializeShopToRelay`, `parseRelayToShop`, and `serializeRelayToShop`.
- `packages/protocol/src/owner-relay.ts`: Implemented `parseOwnerToRelay`, `serializeOwnerToRelay`, `parseRelayToOwner`, and `serializeRelayToOwner`.
- `packages/protocol/src/rules.ts`: Implemented `DEFAULT_RULES` and `validateRules`.
- `packages/protocol/src/http.ts`: Implemented `parseCreateSessionRequest`, `parseCreateSessionResponse`, `parseVerifyResponse`, `parseErrorResponse`, `isSessionId`, `isToken32`, and `isVerifyId`.
- `packages/protocol/src/index.ts`: Exported public API conforming strictly to section 7 of `docs/PROTOCOL_SPEC.md` plus `VERSION`.
- `packages/protocol/src/env.d.ts`: Provided scoped ambient type declarations for `node:zlib` and `node:path` in test files.
- `packages/protocol/src/protocol.test.ts`: Added test suite implementing all 14 test requirements from section 8 of `docs/PROTOCOL_SPEC.md`.
- `docs/progress/TASK-02-protocol.md`: Created progress report.

## Grep for wrappedK in docs/ARCHITECTURE.md
Running `grep -n "wrappedK" docs/ARCHITECTURE.md` confirms all occurrences were replaced with `wrappedKey` without creating `wrappedKeyey`:
```
131:  O->>S: approve {ownerPub, nonce, wrappedKey, mac2}
132:  S->>V: released {ownerPub, nonce, wrappedKey, mac2, blobToken}
168:| Key wrap | `wrappedKey = AES-256-GCM(W, nonce12, K, AAD = sessionId ‖ ownerPub ‖ shopPub)` |
169:| Release MAC | `mac2 = HMAC-SHA-256(chanKey, "release" ‖ sessionId ‖ ownerPub ‖ shopPub ‖ nonce ‖ wrappedKey)`. The viewer verifies it before unwrapping. |
262:| Owner to relay | `approve` | `reqId`, `ownerPub`, `nonce`, `wrappedKey`, `mac2` |
264:| Relay to shop | `released` | `ownerPub`, `nonce`, `wrappedKey`, `mac2`, `blobToken`, `limits` |
```

## Verification
- `pnpm install --frozen-lockfile`: Pass. Clean install in 509ms with up-to-date lockfile.
- `pnpm lint`: Pass. ESLint completed with 0 errors across workspace.
- `pnpm format:check`: Pass. All workspace files match Prettier code style.
- `pnpm typecheck`: Pass. `tsc --noEmit` succeeded across all 11 workspace packages in strict mode with ES2018 target.
- `pnpm test`: Pass. All 12 test files and 80 tests passed workspace-wide.
- `pnpm build`: Pass. Successfully built `apps/owner` (219.65 kB, gzip: 68.64 kB) and `apps/viewer` (0.89 kB, gzip: 0.48 kB).
- Three consecutive protocol test runs (`pnpm vitest run packages/protocol`):
  - Run 1: 2 test files, 44 tests passed (1.61s)
  - Run 2: 2 test files, 44 tests passed (1.52s)
  - Run 3: 2 test files, 44 tests passed (1.50s)
- Acorn ES2018 AST check:
  - Bundled `packages/protocol/src/index.ts` with esbuild targeting `es2018` (30,648 bytes).
  - Parsed the bundle with acorn configured for `ecmaVersion: 2018, sourceType: "module"`.
  - Output: `Acorn ES2018 parse succeeded without error. Root AST node: Program`.

## Dependencies added
| Name | Version | Licence | Size | Reason |
|---|---|---|---|---|
| `@despawn/crypto` | `workspace:*` | Apache-2.0 | local workspace | Only runtime dependency, used solely for strict `base64urlDecode` |
| `esbuild` | `^0.28.2` (0.28.2) | MIT | ~9.5 MB | DevDependency only, used in test item 14 for bundle-size and tree-shaking verification |

## Decisions made
- **Tree-shakeable architecture**: Separated concerns into direction-specific modules (`shop-relay.ts`, `owner-relay.ts`, `http.ts`, `rules.ts`). `shop-relay.ts` does not import owner or location types, allowing bundlers to drop `approxLocation` and `parseOwnerToRelay` completely when `apps/viewer` imports only shop-facing methods.
- **Serializer frame size enforcement**: Configured serializers with an optional internal parameter `maxBytes: number = MAX_FRAME_BYTES`. This allows tests to verify the `TOO_LARGE` exception path deterministically on valid message shapes without modifying protocol constants.
- **Ambient type declarations for test APIs**: Added `packages/protocol/src/env.d.ts` to provide types for `node:zlib` and `node:path` in test files while preserving `types: []` in `tsconfig.json` to enforce strict browser platform compliance on production source files.
- **Fast non-backtracking control character check**: Scanned code points in string fields using char code loops (`c >= 0x00 && c <= 0x1f || c === 0x7f`) to avoid regular expression backtracking vulnerabilities.

## Spec issues
none

## Noticed, not done
none

## Example coverage
All entries in `docs/protocol-examples.json` are covered by tests in `packages/protocol/src/protocol.test.ts`:
| Example entry | Covered by test |
|---|---|
| `ids.sessionId` | Item 4 (`rejects non-canonical base64url encodings`, `rejects base64url with padding`), Item 11 (`validates isSessionId, isToken32, and isVerifyId`) |
| `ids.reqId` | Item 4 (`rejects binary fields with wrong decoded length`), Item 11 (`validates isSessionId, isToken32, and isVerifyId`) |
| `ids.verifyId` | Item 11 (`validates isSessionId, isToken32, and isVerifyId`) |
| `shopToRelay.hello` | Item 1 (parse and round-trip), Item 2 (direction isolation), Item 3 (per-field negatives), Item 4 (B65 first-byte check), Item 7 (ShortText control chars, empty string), Item 13 (serializer size check) |
| `shopToRelay.hb` | Item 1 (parse and round-trip), Item 2 (shared tag hb differentiation), Item 3 (per-field negatives), Item 5 (strictness, __proto__, v checks), Item 8 (seq bounds), Item 9 (ShopViewState validation) |
| `shopToRelay.rendered` | Item 1 (parse and round-trip), Item 2 (direction isolation), Item 3 (per-field negatives), Item 8 (pageCount 1..50 bounds), Item 13 (serializer invalid input) |
| `shopToRelay.printStarted` | Item 1 (parse and round-trip), Item 2 (direction isolation), Item 3 (per-field negatives), Item 6 (exact MAX_FRAME_BYTES acceptance and overflow rejection) |
| `shopToRelay.printed` | Item 1 (parse and round-trip), Item 2 (direction isolation), Item 3 (per-field negatives) |
| `shopToRelay.wiped` | Item 1 (parse and round-trip), Item 2 (direction isolation), Item 3 (per-field negatives), Item 9 (ShopWipeReason validation) |
| `relayToShop.released` | Item 1 (parse and round-trip), Item 2 (direction isolation), Item 3 (per-field negatives for all fields and nested limits), Item 4 (binary field length checks) |
| `relayToShop.denied` | Item 1 (parse and round-trip), Item 2 (direction isolation), Item 3 (per-field negatives), Item 13 (serializer extra field check) |
| `relayToShop.tick` | Item 1 (parse and round-trip), Item 2 (direction isolation), Item 3 (per-field negatives, nullable remainingMs), Item 8 (Millis bounds) |
| `relayToShop.kill` | Item 1 (parse and round-trip), Item 2 (shared tag kill differentiation), Item 3 (per-field negatives), Item 9 (TerminalReason validation) |
| `relayToShop.error` | Item 1 (parse and round-trip), Item 2 (rejection by client-to-relay parsers), Item 3 (per-field negatives), Item 9 (ErrorCode validation) |
| `ownerToRelay.approve` | Item 1 (parse and round-trip), Item 2 (direction isolation), Item 3 (per-field negatives), Item 4 (B65, B12, B48, B32 checks) |
| `ownerToRelay.deny` | Item 1 (parse and round-trip), Item 2 (direction isolation), Item 3 (per-field negatives), Item 13 (serializer type check) |
| `ownerToRelay.kill` | Item 1 (parse and round-trip), Item 2 (shared tag kill differentiation), Item 3 (per-field negatives) |
| `ownerToRelay.hb` | Item 1 (parse and round-trip), Item 2 (shared tag hb differentiation), Item 3 (per-field negatives) |
| `relayToOwner.request` | Item 1 (parse and round-trip), Item 2 (direction isolation), Item 3 (per-field negatives, approxLocation subfield handling), Item 7 (Region control chars, CountryCode rules), Item 8 (EpochMs bounds) |
| `relayToOwner.status` | Item 1 (parse and round-trip), Item 2 (direction isolation), Item 3 (per-field negatives, nullable lastHbMs/remainingMs), Item 8 (printsDone, pending bounds), Item 9 (SessionState validation), Item 13 (serializer invalid input) |
| `relayToOwner.destroyed` | Item 1 (parse and round-trip), Item 2 (direction isolation), Item 3 (per-field negatives), Item 8 (EpochMs and printsDone bounds) |
| `relayToOwner.error` | Item 1 (parse and round-trip), Item 2 (direction isolation), Item 3 (per-field negatives), Item 9 (ErrorCode validation) |
| `http.createSessionRequest` | Item 11 (parse HTTP shapes, per-field negatives, blobBytes bounds, challengeToken checks), Item 7 (challengeToken control chars and length) |
| `http.createSessionResponse` | Item 11 (parse HTTP shapes, per-field negatives, ownerToken check, limits validation) |
| `http.verifyResponse` | Item 11 (parse HTTP shapes), Item 7 (purposeLabel control chars and length 0 acceptance), Item 9 (VerifyStatus validation) |
| `http.errorResponse` | Item 11 (parse HTTP shapes, ErrorCode check) |

## Mutation check
Each mutation was introduced, verified to fail the designated tests, and cleanly reverted:
1. **Allow unknown extra keys in strict objects**:
   - Change: Commented out `return false` for unknown keys in `checkObjectKeys` (`packages/protocol/src/check.ts`).
   - Failing tests:
     - `Item 5: Strictness > rejects extra unknown keys in strict objects`
     - `Item 2: Direction isolation > shop-to-relay examples fail in other direction parsers`
     - `Item 2: Direction isolation > relay-to-shop examples fail in client parsers and cross-relay parsers`
     - `Item 2: Direction isolation > differentiates shared tag hb by field differences`
     - `Item 2: Direction isolation > differentiates shared tag kill by field differences`
     - `Item 13: Serializers > throws ProtocolError on invalid input`
   - Revert: Reverted cleanly. All 44 tests passed.
2. **Accept a B65 value whose first byte is not 0x04**:
   - Change: Commented out `bytes[0] !== 0x04` check in `checkBinaryField` (`packages/protocol/src/check.ts`).
   - Failing test:
     - `Item 4: Binary fields > rejects B65 whose first byte is not 0x04`
   - Revert: Reverted cleanly. All 44 tests passed.
3. **Remove the frame-size check**:
   - Change: Commented out `frame.length > MAX_FRAME_BYTES` and `encoder.encode(frame).length > MAX_FRAME_BYTES` in `checkFrameSize` (`packages/protocol/src/check.ts`).
   - Failing tests:
     - `Item 6: Size > rejects frames exceeding MAX_FRAME_BYTES with TOO_LARGE`
     - `Item 6: Size > accepts frame of exactly MAX_FRAME_BYTES bytes if otherwise valid`
   - Revert: Reverted cleanly. All 44 tests passed.
4. **Remove the try/catch around JSON.parse**:
   - Change: Removed `try/catch` and assigned `JSON.parse(frame)` directly in `parseShopToRelay` (`packages/protocol/src/shop-relay.ts`).
   - Failing test:
     - `Item 12: Never throws (fuzz) > feeds each parser at least 5000 fuzzed inputs without throwing and verifies round-trips` (printed seed: 178703653, threw SyntaxError)
   - Revert: Reverted cleanly. All 44 tests passed.
5. **Accept v: "1" (string)**:
   - Change: Relaxed version check to `x.v !== 1 && x.v !== '1'` in `validateShopToRelay` (`packages/protocol/src/shop-relay.ts`).
   - Failing test:
     - `Item 5: Strictness > rejects v of 2, "1", or missing`
   - Revert: Reverted cleanly. All 44 tests passed.
6. **Accept an empty string for ShortText**:
   - Change: Changed `x.length >= 1` to `x.length >= 0` in `isShortText` (`packages/protocol/src/check.ts`).
   - Failing test:
     - `Item 7: Text > rejects empty string for ShortText, Region, challengeToken but allows for purposeLabel`
   - Revert: Reverted cleanly. All 44 tests passed.

## Shop bundle size
Measured using esbuild JS API bundling an entry that imports only `parseRelayToShop` and `serializeShopToRelay` (`bundle: true, minify: true, format: "esm", target: "es2018"`):
- Uncompressed minified bundle size: **7,081 bytes**
- Gzipped bundle size: **2,624 bytes** (well under the 8,192 bytes threshold)
- Tree-shaking verification: Confirmed neither `approxLocation` nor `parseOwnerToRelay` appears anywhere in the output bundle.

## Commits
- `d610bbc`: docs: add protocol spec, align architecture wording
- `46c80f0`: chore(protocol): add crypto dependency and tsconfig
- `9fb46ef`: feat(protocol): implement wire formats, validators, constants, and http shapes
- `7434a3d`: test(protocol): add comprehensive test suite for protocol spec section 8
