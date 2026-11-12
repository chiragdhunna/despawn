# TASK-01: packages/crypto

## Summary
Implemented the `@despawn/crypto` package strictly adhering to `docs/CRYPTO_SPEC.md` and `docs/ARCHITECTURE.md` section 5.2. Built pure WebCrypto cryptographic primitives and stateful chunk encryptor/decryptor objects using only `globalThis.crypto.subtle` and `getRandomValues` without third-party libraries or I/O. Targeted ES2018 in `packages/crypto/tsconfig.json` to ensure compatibility with Chrome 109 in the shop viewer bundle, avoiding post-ES2018 APIs or syntax. Developed a comprehensive test suite across 12 spec categories reproducing every vector from `docs/crypto-vectors.json` byte for byte and verifying resilience against tampering, truncation, replay, and malformed inputs. Added package license metadata and aligned the release MAC specification across architecture documentation.

## Changes
- `package.json`: Added "license": "Apache-2.0".
- `apps/owner/package.json`: Added "license": "Apache-2.0".
- `apps/viewer/package.json`: Added "license": "Apache-2.0".
- `packages/protocol/package.json`: Added "license": "Apache-2.0".
- `packages/crypto/package.json`: Added "license": "Apache-2.0".
- `packages/bundle/package.json`: Added "license": "Apache-2.0".
- `packages/render/package.json`: Added "license": "Apache-2.0".
- `packages/compose/package.json`: Added "license": "Apache-2.0".
- `packages/ui/package.json`: Added "license": "Apache-2.0".
- `packages/server-core/package.json`: Added "license": "Apache-2.0".
- `adapters/node/package.json`: Added "license": "Apache-2.0".
- `adapters/cloudflare/package.json`: Added "license": "Apache-2.0".
- `SECURITY.md`: Updated advisory reporting link to `https://github.com/chiragdhunna/despawn/security/advisories/new`.
- `docs/CRYPTO_SPEC.md`: Added normative cryptographic specification v1.
- `docs/crypto-vectors.json`: Added reference test vectors for known-answer tests.
- `docs/ARCHITECTURE.md`: Aligned release MAC formula to cover wrap nonce and added pointer to crypto spec.
- `packages/crypto/tsconfig.json`: Set target to ES2018, lib to ["ES2018", "DOM"], resolveJsonModule to true, and types to [].
- `packages/crypto/src/errors.ts`: Implemented `CryptoError` class with four codes and static message mappings.
- `packages/crypto/src/bytes.ts`: Implemented `utf8`, `concatBytes`, `u32be`, `u64be` (safe integer word splitting without BigInt), `bytesToHex`, and `hexToBytes`.
- `packages/crypto/src/base64url.ts`: Implemented strict RFC 4648 section 5 base64url encode and decode with canonical re-encoding checks.
- `packages/crypto/src/random.ts`: Implemented `randomBytes` (chunked for >65536 byte buffers) and ID/secret generators.
- `packages/crypto/src/channel.ts`: Implemented `deriveChannelKey`, `computeHelloMac`, `verifyHelloMac`, `computeSas`, `computeReleaseMac`, and `verifyReleaseMac`.
- `packages/crypto/src/agreement.ts`: Implemented `generateEcdhKeyPair`, `wrapFileKey`, and `unwrapFileKey` with memory zeroing on raw keys.
- `packages/crypto/src/chunks.ts`: Implemented `importFileKey`, `createChunkEncryptor`, and `createChunkDecryptor`.
- `packages/crypto/src/index.ts`: Re-exported public API matching spec section 5 alongside package version export.
- `packages/crypto/src/crypto.test.ts`: Added test suite implementing all 12 test sections from `docs/CRYPTO_SPEC.md`.
- `docs/progress/TASK-01-crypto.md`: Added progress report.

## Verification
- `pnpm install --frozen-lockfile`: Pass. Clean install using frozen lockfile in 654ms.
- `pnpm lint`: Pass. ESLint completed with 0 errors across workspace.
- `pnpm format:check`: Pass. Prettier verified all files adhere to code style.
- `pnpm typecheck`: Pass. `tsc --noEmit` passed on all 11 workspace packages and applications with strict ES2018 checks.
- `pnpm test`: Pass. Vitest ran 10 test files (29 tests total, all passed).
- `pnpm build`: Pass. Built `apps/owner` (219.65 kB) and `apps/viewer` (0.89 kB).
- Three consecutive crypto test runs (`pnpm vitest run packages/crypto`):
  - Run 1: 2 test files, 21 tests passed (530ms)
  - Run 2: 2 test files, 21 tests passed (546ms)
  - Run 3: 2 test files, 21 tests passed (531ms)

## Vector coverage
Every vector in `docs/crypto-vectors.json` is asserted by at least one test in `packages/crypto/src/crypto.test.ts`:
- `inputs.sessionIdHex`: Verified across Hello MAC, SAS, Wrap & Unwrap, Release MAC, and Chunks tests.
- `inputs.linkSecretHex`: Verified in Hello MAC and Release MAC channel key derivations.
- `inputs.fileKeyHex`: Verified in Wrap & Unwrap and Chunks known-answer tests.
- `inputs.noncePrefixHex`: Verified in Chunks known-answer and Wrap tests.
- `inputs.wrapNonceHex`: Verified in Wrap & Unwrap and Release MAC tests.
- `inputs.shopPrivateJwk` & `inputs.ownerPrivateJwk`: Verified in Wrap & Unwrap known-answer tests.
- `inputs.shopPublicRawHex` & `inputs.ownerPublicRawHex`: Verified in Hello MAC, SAS, Wrap & Unwrap, and Release MAC tests.
- `expected.channelKeyHex`: Verified in Hello MAC test.
- `expected.helloMacHex`: Verified in Hello MAC known-answer test.
- `expected.sas`: Verified in SAS test ("7188").
- `expected.ecdhSharedSecretHex`: Directly asserted in Wrap & Unwrap test.
- `expected.wrapKeyHex`: Directly asserted in Wrap & Unwrap test.
- `expected.wrappedKeyHex`: Verified in Wrap & Unwrap test.
- `expected.releaseMacHex`: Verified in Release MAC test.
- `chunks[0]` & `chunks[1]` (plaintext, nonce, AAD, sealedHex): Verified in Chunks known-answer test.
- `base64url` vectors (0..2): Verified in Encoding test (encode and decode round-trips).

## Mutation check
1. Changed HKDF info label `"despawn/v1/wrap"` to `"despawn/v1/wrap2"` in `packages/crypto/src/agreement.ts`:
   - Failing test: `4. Wrap & Unwrap > reproduces vector wrappedKeyHex and opens vector chunks` (AssertionError: expected wrappedKey to match expected hex).
   - Reverted mutation.
2. Flipped the `isFinal` byte in chunk AAD (`isFinal ? 0 : 1`) in `packages/crypto/src/chunks.ts`:
   - Failing tests:
     1. `6. Chunks, known answer > reproduces both vector sealedHex values including nonce and AAD behavior`
     2. `8. Chunks, limits > handles exact CHUNK_SIZE, rejects CHUNK_SIZE + 1, and handles multi-chunk round trips`
     3. `12. Full flow (Owner & Shop end-to-end handshake & stream) > completes the entire owner and shop protocol lifecycle successfully`
   - Reverted mutation.

## Dependencies added
none

## Decisions made
- Wrapped typed arrays in `new Uint8Array(...)` when passed into WebCrypto methods to satisfy TypeScript's ES2018 `BufferSource` definition without `any` or `@ts-ignore`.
- Zeroed plaintext `rawFileKey` bytes in `unwrapFileKey` via a `try...finally` block ensuring erasure even if key import fails.
- Padded 4-digit SAS output using `substring` and string concatenation to avoid ES2017 `padStart` dependency under ES2018 settings.

## Spec issues
none

## Noticed, not done
1. Vitest logs an optional warning about esbuild script approval in pnpm 10; native compilation can be explicitly configured via `onlyBuiltDependencies` when needed.

## Commits
- `b3f0d1f`: chore: add license fields and fix advisory link
- `dd1781d`: docs: add crypto spec and vectors, align release MAC
- `0b28910`: feat(crypto): implement WebCrypto primitives, channel, wrap, and chunk streaming
- `5230fd5`: test(crypto): add test suite covering all crypto spec items and vectors
