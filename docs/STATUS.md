# Despawn: Status

Last updated with the v0.1 candidate build. This page is meant to be honest: it lists what exists, how it was verified, and what has **not** been verified.

## What works, and how it was checked

| Area | State | Evidence |
|---|---|---|
| Cryptography (`packages/crypto`) | Done | Known-answer vectors cross-checked by two independent implementations, tamper and misuse tests, concurrency and fail-closed tests, differential fuzzing during review |
| Wire protocol and validators (`packages/protocol`) | Done | Strict validators, per-direction parsers, 24,000-frame differential fuzz during review, shop-side bundle under 3 KB gzip |
| Session state machine | Done | Transition scenarios, exhaustive state-by-event checks, 40,000-event random walks against invariants |
| Print bundle (`packages/bundle`) | Done | Round trips, every single-bit flip rejected, truncation, reordering, trailing data |
| Relay core (`packages/server-core`) | Done | 31 tests with real crypto and a manual clock: tokens, single approval, two shops, heartbeats, timeouts, kill, caps |
| Node server (`adapters/node`) | Done | Real HTTP and WebSocket tests, path traversal, headers and CSP, limits, startup purge |
| Shop viewer (`apps/viewer`) | Done | Real Chromium: handshake, decrypt, A4 print layout, wipe, no browser residue, no CSP violations. Bundle guard: ES2018, 11 KB gzip, no storage, no inline code |
| Owner app (`apps/owner`) | Done for v0.1 scope | Real Chromium: PDF and PNG import, layouts, approval with matching code, live view, destroy, receipt. Session logic tested against the real relay |
| End to end | 7 scenarios pass | Full flow, two browsers, deny, owner kill, connection loss, ID card sheet at 300 dpi, malformed links |

## Implemented features (v0.1)

PDF, PNG, JPEG, GIF, WebP, BMP and SVG import (type from file contents). Layouts: full page, fit, ID card at actual size (with automatic margin trimming and crop marks). Paper A4, A5, Letter, portrait or landscape. Colour, grey, black and white. Purpose-bound watermark and the self-attested stamp with a reference code. Page selection. Rules: link validity, visible time, number of prints, destroy after print. Link and QR code. Live approval with a matching 4-digit code and hold-to-confirm. Live countdown and **Destroy now**. Local receipts. English and Hindi (Hindi needs native review). Dark and Paper themes. Installable PWA with an offline app shell. Screen wake lock during a session.

## Not implemented yet

| Item | Requirement |
|---|---|
| Masking regions, automatic ID-number masking | PRP-06, PRP-09 |
| HEIC, TIFF, Office, text, archives, video and other formats | ING-05 to ING-09 |
| Page reordering | PRP-07 |
| Verification QR and revocation | VER-01 to VER-03 |
| Web Push for approval requests | APR-05 |
| Phone-direct print mode | PRT-05 |
| Android share target (the file picker works) | ING-01 |
| Cloudflare and AWS adapters | HOST-02, HOST-03 |
| Turnstile or proof-of-work on session creation (the hook `verifyChallenge` exists) | SEC-07 |
| Reproducible builds, independent security review | SEC-05, SEC-09 |

## Not verified

- Real printers, real shop PCs and the browser print dialog. Layout was checked with Chromium's print-to-PDF only, and `window.print` was replaced in tests.
- Chrome 109 on Windows 7. The viewer bundle is verified to be valid ES2018 and uses no newer APIs, but it has not been run on that browser.
- Firefox, Safari, iOS, and real phones. Tests ran in Chromium on Linux.
- Password-protected PDFs (the prompt exists, the path has no automated test).
- The Docker image and compose file (no Docker was available when they were written).
- GitHub Actions on GitHub's runners. The CI workflow is unchanged apart from the viewer check, and the `e2e` workflow is manual.
- Hindi strings, which were written without native review.

## Known limits (by design)

No software can stop a screenshot, a saved PDF from the print dialog or a photo of the paper. Despawn limits the damage with a baked watermark, a short exposure window and an owner who is present. The page-wipe confirmation shown on the receipt is reported by the shop page itself. JavaScript cannot guarantee memory scrubbing. A malicious operator of a hosted instance could serve altered viewer code, so self-hosting is the high-assurance option.
