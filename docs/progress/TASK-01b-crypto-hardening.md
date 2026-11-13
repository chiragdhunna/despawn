# TASK-01b: packages/crypto hardening (concurrency, fail-closed, error hygiene)

## Summary
Hardened `packages/crypto` against concurrency misuse, state corruption, and exception leakage while maintaining strict compatibility with `docs/CRYPTO_SPEC.md` and ES2018. Synchronous index assignment and input copying were implemented in `ChunkEncryptor.seal()` before any asynchronous dispatch to eliminate nonce reuse under concurrent invocation. A promise-chain queue was introduced in `ChunkDecryptor.open()` to process chunks strictly sequentially and enforce fail-closed semantics upon any authentication or input validation failure. All public asynchronous WebCrypto operations were wrapped with an internal `guard()` helper ensuring unexpected platform exceptions (e.g. `DOMException`) are converted into `CryptoError('INVALID_INPUT')`. Intermediate derived key buffers are now zeroed on a best-effort basis in `finally` blocks.

## Changes
- `docs/CRYPTO_SPEC.md`: Amended section 3.8 (stream concurrency and fail-closed rules), section 4 (exception guarding guarantee), and section 6 (added test item 13).
- `packages/crypto/src/errors.ts`: Added internal `guard<T>` helper to intercept non-`CryptoError` exceptions.
- `packages/crypto/src/chunks.ts`: Implemented synchronous index increment, fail-closed encryptor state, serialized decryptor queue (`tail`), fail-closed decryptor behavior, and guarded `importFileKey`.
- `packages/crypto/src/agreement.ts`: Wrapped `generateEcdhKeyPair`, `wrapFileKey`, and `unwrapFileKey` in `guard()`, and added best-effort buffer zeroing in `finally` blocks.
- `packages/crypto/src/channel.ts`: Wrapped all public async MAC and SAS functions in `guard()`, and added best-effort buffer zeroing for derived channel key bits.
- `packages/crypto/src/misuse.test.ts`: Added 8 misuse and concurrency test cases (4a through 4h) verifying stream concurrency, queue serialization, fail-closed state, exception hygiene, and post-final behavior.
- `docs/progress/TASK-01b-crypto-hardening.md`: Created progress report.

## Verification
- `pnpm install --frozen-lockfile`: Pass. Clean install in 545ms.
- `pnpm lint`: Pass. ESLint completed with 0 errors across workspace.
- `pnpm format:check`: Pass. All workspace files match Prettier code style.
- `pnpm typecheck`: Pass. `tsc --noEmit` succeeded across all 11 workspace projects in strict mode.
- `pnpm test`: Pass. All 11 test files and 37 tests passed.
- `pnpm build`: Pass. Successfully built `apps/owner` (219.65 kB) and `apps/viewer` (0.89 kB).
- Three consecutive crypto test runs (`pnpm vitest run packages/crypto`):
  - Run 1: 3 test files, 29 tests passed (621ms)
  - Run 2: 3 test files, 29 tests passed (680ms)
  - Run 3: 3 test files, 29 tests passed (659ms)
- Mutation checks:
  1. Moved `this.index++` and `isFinal` check in `seal()` back to after `await encrypt`: Tests 4a and 4b failed with `CryptoError: Cryptographic authentication failed`. Reverted cleanly.
  2. Removed `tail` promise queue in `open()` and called `openOne()` directly: Tests 4c and 4d failed (assertion failed on fulfilled count in 4c; authentication failed in 4d). Reverted cleanly.
  3. Commented out `this.failed = true` on decrypt failure in `openOne()`: Test 4e failed (second open resolved instead of rejecting with `AUTH_FAILED`). Reverted cleanly.
  4. Removed `guard()` wrapper from `wrapFileKey`: Test 4g failed with uncaught platform `InvalidAccessError` DOMException instead of `CryptoError`. Reverted cleanly.

## Dependencies added
none

## Decisions made
- **Promise-chain queue design**: In `ChunkDecryptorImpl.open()`, calls are queued onto `this.tail` via `this.tail.then(() => this.openOne(copy))` and updated with `this.tail = run.then(() => undefined, () => undefined)` so rejection of one call does not stall or break subsequent calls in the pipeline.
- **Internal exception guard**: Implemented `guard<T>(fn: () => Promise<T>): Promise<T>` in `packages/crypto/src/errors.ts` without exporting it in `index.ts`. Any non-`CryptoError` thrown from underlying platform APIs is converted to `CryptoError('INVALID_INPUT')`.
- **Memory zeroing**: Derived ArrayBuffers (`sharedBits`, `wrapKeyBits`, `bits`, `rawFileKey`) are wiped using `new Uint8Array(buf).fill(0)` in `finally` blocks, accompanied by a comment noting that memory scrubbing in JavaScript is best-effort.

## Spec issues
none

## Noticed, not done
none

## Commits
- `f26fb5d`: docs: amend crypto spec for concurrency and fail-closed behavior
- `5c6d542`: fix(crypto): harden concurrency, fail-closed state, and exception hygiene
- `3b9a5f3`: test(crypto): add misuse and concurrency test suite
