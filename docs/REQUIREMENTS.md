# Despawn: Requirements

Version 0.1 (draft) · Status: for review before Phase 0

## 1. Purpose

Despawn lets a person print a sensitive document at a shop they do not control, without the shop ending up with a reusable copy. The owner controls the whole session from their own phone. Nothing is installed on the shop's computer, and the same flow works at any shop.

## 2. Problem statement

Today the flow is: send a file by WhatsApp or email, the shopkeeper prints it, and the file stays on his system (Downloads, chat history, backups, recycle bin). The owner cannot verify deletion and cannot control what happens next. The same exposure applies to any file type (PDF, image, Office, video, anything).

## 3. Hard constraints (from the product owner)

| ID | Constraint |
|---|---|
| C1 | All control sits with the sender (owner). The shopkeeper has no option to keep or reuse the file. |
| C2 | Nothing may be installed on the shopkeeper's system, because the owner uses a different shop each time. |
| C3 | The solution must handle any file format that can be shown on a computer, with an honest fallback for formats that cannot. |
| C4 | The project is fully open source and free to self-host. |
| C5 | No accounts for either party. |

## 4. Goals and non-goals

**Goals**
- G1. After a session, the shop computer holds no copy of the document and no way to get one back.
- G2. The link the shop receives is worthless without the owner's live approval.
- G3. Whatever can still escape (screenshot, saved PDF) is a watermarked, purpose-bound, revocable image.
- G4. End-to-end encryption: the server never sees plaintext or the file key.
- G5. Setup at the shop takes under one minute and needs no technical skill from the shopkeeper.
- G6. Cheap enough to run for free or near-free (see COSTING.md).

**Non-goals**
- N1. Preventing photographs of screens or paper. No software can.
- N2. DRM, screen-capture blocking, or controlling copies after they leave the printer.
- N3. Protecting against a compromised owner phone.
- N4. Controlling what a shop printer's internal drive retains (documented as a risk instead).
- N5. Payments, user accounts, or a marketplace of shops.

## 5. Users

| Persona | Description | Needs |
|---|---|---|
| **Owner** (Asha) | Student or professional printing an ID, certificate or statement. Android phone, mobile data, little patience at a busy counter. | One-thumb flow, clear approval step, a visible kill switch, a receipt. |
| **Shop operator** (Ravi) | Runs a photocopy shop. Windows PC, any browser, a USB or network printer, WhatsApp. Not technical, not necessarily hostile. | Open a link, see the document, press Print. Instructions in Hindi or English. |
| **Recipient** (Bank clerk) | Receives the printout. | Can optionally scan a QR to confirm the copy is valid and its stated purpose. |
| **Self-hoster / maintainer** | Runs their own instance, contributes code. | One-command deploy, documented limits, no telemetry. |

## 6. Assumptions

- A1. The owner has a smartphone with a modern browser and internet during the session.
- A2. The shop PC has a modern browser and internet. Offline shops are out of scope.
- A3. The shop prints through the browser's normal print dialog (USB or network printer).
- A4. The owner is physically at the counter and can see the shop screen while approving.

## 7. Glossary

| Term | Meaning |
|---|---|
| Session | One print job from preparation to destruction. |
| Print bundle | The encrypted, page-image package for a session. |
| Link secret | Random value in the link's `#fragment`, used to authenticate the shop's key. Never sent to the server, never the file key. |
| SAS code | Short 4-digit code both screens show so the owner can confirm the right browser is asking. |
| Despawn | The moment the shop page wipes itself and the server deletes the ciphertext. |
| Receipt | Owner-side record of what happened in a session. |

## 8. Functional requirements

Priority: **M** must, **S** should, **C** could. Phase: P1 = v0.1 MVP, P2 = v0.2, P3 = v0.3, P4 = v1.0, P5 = later.

### 8.1 Ingest and formats (see FILE_SUPPORT.md)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| ING-01 | Accept files from a file picker, and from the Android share sheet when installed as a PWA. | M | P1 |
| ING-02 | Detect type from file contents (magic bytes), not the extension. | M | P1 |
| ING-03 | Support PDF, including password-protected PDFs (prompt for the password, never store it). | M | P1 |
| ING-04 | Support JPEG, PNG, WebP, GIF, BMP, AVIF, SVG. | M | P1 |
| ING-05 | Support HEIC/HEIF and multi-page TIFF. | S | P2 |
| ING-06 | Support plain text, Markdown, CSV, JSON and source code via a print renderer. | S | P2 |
| ING-07 | Support DOCX, XLSX, PPTX, ODT, ODS, ODP, RTF with an in-browser renderer (approximate layout). | S | P2 |
| ING-08 | Offer an optional full-fidelity Office engine (plugin, heavier download). | C | P3 |
| ING-09 | Support archives (pick a file inside), video (pick frames), audio (cover and metadata sheet), RAW photos (embedded preview), PSD, DXF, 3D snapshots, fonts (specimen). | C | P3 |
| ING-10 | For unsupported types, say so plainly and explain the universal fallback (OS print-to-PDF, then import). | M | P1 |
| ING-11 | Enforce limits: 50 pages and 25 MB ciphertext by default, configurable by self-hosters. | M | P1 |
| ING-12 | Parse all files inside a sandboxed Web Worker with no network access and memory limits. | M | P1 |
| ING-13 | Scan a paper document with the camera. | C | P4 |

### 8.2 Prepare

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| PRP-01 | Flatten every document to raster pages. Strip metadata, EXIF, text layer, annotations, scripts. | M | P1 |
| PRP-02 | Layout presets: full page, fit to page, ID card at actual size (85.6 × 54 mm) with front and back on one sheet, two per page. Paper sizes A4, A5, Letter. | M | P1 |
| PRP-03 | Purpose-bound watermark: preset purposes (KYC, SIM, bank, job application) plus custom text, auto date, session short ID, tiled diagonal plus corner stamp, density and opacity control. | M | P1 |
| PRP-04 | "Self-attested for [purpose] only" stamp variant, following the common Indian photocopy convention. | S | P1 |
| PRP-05 | Live preview that matches the printed output (same renderer as the shop viewer). | M | P1 |
| PRP-06 | Mask regions (black box or blur) before encryption. | S | P2 |
| PRP-07 | Select, reorder and delete pages. | S | P2 |
| PRP-08 | Colour, greyscale and black-and-white modes, brightness and contrast. | S | P2 |
| PRP-09 | Auto-detect and mask ID numbers using on-device OCR. | C | P4 |
| PRP-10 | Invisible per-session forensic watermark. | C | P5 |

### 8.3 Session

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| SES-01 | Create a session with random 128-bit ID and two timers: **link validity** (default 30 min, 5 min to 24 h) and **live time** after approval (default 2 min, max 10 min). | M | P1 |
| SES-02 | Limit prints per session (default 1). | S | P1 |
| SES-03 | The link carries a channel secret in the URL fragment and never carries the file key. | M | P1 |
| SES-04 | Owner can cancel at any time before approval, which destroys the key. | M | P1 |
| SES-05 | Single use: once released, further approval requests are rejected. | M | P1 |
| SES-06 | Owner can prepare and upload at home, then approve later at the shop within the link validity. | S | P1 |
| SES-07 | Link and short URL can be shared by any channel, and a QR is shown for typing-averse operators. | M | P1 |

### 8.4 Approval

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| APR-01 | Owner receives a live request showing browser, OS, approximate location, time and the 4-digit SAS code. | M | P1 |
| APR-02 | Approve requires a deliberate hold-to-confirm after the owner compares the code with the shop screen. | M | P1 |
| APR-03 | Multiple simultaneous requests are listed separately. Approving one denies the others. | M | P1 |
| APR-04 | Owner can deny or kill at any moment. | M | P1 |
| APR-05 | Web Push notification when the app is in the background. | S | P2 |
| APR-06 | Keep the screen awake during a live session (Wake Lock). | S | P1 |

### 8.5 Shop viewer

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| VWR-01 | Runs in current Chrome, Edge, Firefox and Safari, and in Chrome 109 (last version for Windows 7/8). No install, no login. | M | P1 |
| VWR-02 | UI in English and Hindi with a visible language toggle. | M | P1 |
| VWR-03 | Before approval show only the code and status. After approval decrypt in memory and render pages with a Print button. | M | P1 |
| VWR-04 | Never write document data to disk: no download links, no service worker, `Cache-Control: no-store`, in-memory blobs only. | M | P1 |
| VWR-05 | Visible countdown and watermark overlay. | M | P1 |
| VWR-06 | Heartbeat to the server. Missing heartbeat or owner presence for 10 s wipes the page (fail closed). | M | P1 |
| VWR-07 | On print complete, kill, expiry or error: wipe canvases and images, revoke blob URLs, zero buffers, drop keys, show "Destroyed". | M | P1 |
| VWR-08 | No third-party requests, analytics, fonts or scripts. Strict CSP. | M | P1 |
| VWR-09 | Plain instructions with pictograms: "Press Print, choose your printer." Help for blocked print dialogs. | S | P1 |

### 8.6 Print

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| PRT-01 | Print through the browser's print pipeline with exact page size, zero margins, one image per page. | M | P1 |
| PRT-02 | Detect `afterprint` and schedule the wipe, with a timer fallback because the event is unreliable on some browsers. | M | P1 |
| PRT-03 | Optional footer stamp with verification QR. | S | P3 |
| PRT-04 | Count prints. A further print needs a fresh approval. | S | P2 |
| PRT-05 | **Phone-direct mode:** print from the owner's phone to a Wi-Fi Direct, AirPrint or Mopria printer so the shop PC is never involved. | S | P2 |

### 8.7 Destroy

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| DES-01 | Owner "Destroy now" is always available during a live session. | M | P1 |
| DES-02 | Server deletes the ciphertext on destroy, expiry or abort, and reports it to the owner. | M | P1 |
| DES-03 | The owner's phone erases session key material and the stored ciphertext reference. | M | P1 |
| DES-04 | Show a receipt listing what was wiped and when. Mark shop-side wipe as page-reported. | M | P1 |
| DES-05 | Per-session keys never reach the server, so leftover ciphertext (backups, caches) is unreadable. | M | P1 |

### 8.8 Verification (optional per job)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| VER-01 | Printed copy can carry a QR to a public page showing VALID, REVOKED or EXPIRED, the owner-chosen purpose label and issue date. No personal data. | S | P3 |
| VER-02 | Owner can revoke a copy from the receipt. | S | P3 |
| VER-03 | Verification records are minimal and auto-deleted (default 12 months). | S | P3 |

### 8.9 History, settings, hosting

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| HIS-01 | Receipts stored locally on the phone only (IndexedDB), exportable, deletable. No server-side history. | S | P2 |
| SET-01 | Languages: English and Hindi at launch, resource files for community translations. | M | P1 |
| SET-02 | Dark (default) and Paper (light) themes, defaults for purpose, timers, haptics and sound (off by default). | S | P1 |
| SET-03 | Relay server URL override so the app can point at a self-hosted instance. | M | P1 |
| HOST-01 | One-command self-host (Docker Compose) with documented environment limits. | M | P1 |
| HOST-02 | Deployment guide for Cloudflare Workers, Durable Objects and R2. | M | P2 |
| HOST-03 | Community AWS serverless adapter. | C | P4 |

## 9. Non-functional requirements

### 9.1 Security

| ID | Requirement |
|---|---|
| SEC-01 | The server never sees plaintext or the file key. |
| SEC-02 | AES-256-GCM chunked encryption with authenticated chunk order and length. Key transfer via ephemeral ECDH P-256 and HKDF-SHA-256. |
| SEC-03 | The shop's public key is authenticated with a MAC keyed from the link secret, so a malicious relay cannot swap it. |
| SEC-04 | A 4-digit SAS code lets the owner confirm that the browser asking is the one in front of them. |
| SEC-05 | Strict Content-Security-Policy, Subresource Integrity, no third-party scripts, and published build hashes. Reproducible builds by v1.0. |
| SEC-06 | Untrusted file parsing is sandboxed (Worker, no network, memory and time caps, decompression-bomb limits). SVG renders only as an image, HTML only in a script-less sandboxed frame. |
| SEC-07 | Abuse controls on the relay: size and time caps, per-IP rate limits, a proof-of-work or Turnstile challenge on session creation, a global daily cap. |
| SEC-08 | Pinned dependencies, SBOM, automated vulnerability scanning, signed releases. |
| SEC-09 | Independent review before v1.0. `SECURITY.md` with a private disclosure channel. |

### 9.2 Privacy

| ID | Requirement |
|---|---|
| PRV-01 | No accounts, cookies, analytics or persistent identifiers. |
| PRV-02 | Server stores only: ciphertext (until destroyed or expired), session metadata (random IDs, timestamps, state), short-lived rate-limit counters on hashed IPs. |
| PRV-03 | File names never leave the phone. Logs contain no content and no file names. |
| PRV-04 | Approximate location shown to the owner is derived transiently from the request and not stored. |
| PRV-05 | Operators of public instances should publish a privacy notice and take legal advice on local data-protection law (for India, the DPDP Act). The design keeps operators from holding readable personal data. |

### 9.3 Performance

| ID | Requirement |
|---|---|
| PERF-01 | Prepare a 10-page A4 PDF on a mid-range Android phone in under 15 s. |
| PERF-02 | Shop viewer shows "waiting" in under 2 s on 4G, and first page within 3 s of approval for 5 pages up to 5 MB. |
| PERF-03 | Shop viewer JavaScript at most 100 KB gzip. Owner app initial load at most 250 KB gzip, renderers lazy-loaded. |
| PERF-04 | Owner app processes one page at a time. Peak memory at most 300 MB. |

### 9.4 Compatibility

- Owner app: Chrome, Edge and Samsung Internet on Android (last two years), Safari 16.4+ on iOS (PWA limits apply, see ARCHITECTURE.md), current desktop browsers.
- Shop viewer: ES2018 target, WebCrypto only, no WebAssembly, no modern-only APIs. Must work on Chrome 109 on Windows 7/8, current Edge, Firefox and Safari.
- Printing: Windows, macOS, Linux and ChromeOS browser print dialogs.

### 9.5 Reliability

- Fail closed everywhere: any lost connection, timeout or error ends in a wipe.
- Server restarts must not resurrect a destroyed session or leave an orphaned blob (lifecycle backstop on storage).
- Public instance availability is best effort, with no SLA.

### 9.6 Accessibility and i18n

- WCAG 2.2 AA, 48 px touch targets, screen-reader labels, reduced-motion support, colour never the only signal.
- English and Hindi at launch with Devanagari-safe font stacks. Layout must tolerate text growth and be RTL-ready.

### 9.7 Openness and maintainability

- Permissive open-source license (proposed Apache-2.0), CONTRIBUTING, Code of Conduct, architecture decision records, issue templates, good-first-issues.
- TypeScript strict mode, protocol schemas shared between client and server, test vectors for all crypto.

## 10. MVP acceptance criteria (v0.1)

1. An owner prepares a one-page PDF ID card and has a shareable link in under 60 seconds.
2. A browser that opens the link without approval receives no ciphertext and no key (verified by network inspection in an automated test).
3. After approval with the matching code, the shop page renders and prints at a physical size of A4 with at least 200 dpi.
4. After print plus grace period, kill, expiry or heartbeat loss, the page holds no images or canvases and shows "Destroyed". The server blob is deleted.
5. Opening the link in a second browser produces a second request on the owner's phone with a different code. Approving one never releases the key to the other.
6. A scan of the relay's database and storage after a session finds no plaintext marker planted in the test document.
7. Heartbeat loss of 10 s or more wipes the page.
8. The viewer works on Chrome 109 (Windows 7 VM), current Chrome, Edge, Firefox and Safari.
9. A fresh self-host with `docker compose up` completes the whole flow on localhost.

## 11. Release plan

Effort is indicative for one full-time developer. Scale up for part-time work.

| Phase | Scope | Indicative effort |
|---|---|---|
| **0. Spike** | Crypto handshake, pdf.js render, print on a shop-style PC, `afterprint` behaviour, Chrome 109 check, size of Office engines | 1–2 weeks |
| **1. MVP v0.1** | PDF and images, watermark, ID-card layout, session protocol, viewer, destroy, Docker self-host, Cloudflare adapter | 4–6 weeks |
| **2. v0.2** | HEIC, TIFF, text, Office approximations, masking, page editing, history, Web Push, Hindi, phone-direct print | 4 weeks |
| **3. v0.3** | Verification QR and revoke, archives, video frames, full-fidelity Office plugin | 3–4 weeks |
| **4. v1.0** | Hardening, reproducible builds, external review, OCR auto-mask, community translations | 4–6 weeks |
| **5. Later** | WebRTC peer-to-peer transport, view-only mode for video, invisible watermark, native wrappers | open |

## 12. Risks

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Shopkeeper screenshots, photographs, or saves a PDF from the print dialog. | High | Medium | Baked watermark, revocable verification, ~1 minute window, owner present. Accepted residual risk. |
| R2 | Browser print quirks (page size, `afterprint`, blocked dialogs) on old shop PCs. | High | Medium | Phase 0 spike on real hardware, timer fallback, in-page help. |
| R3 | Owner approves the wrong request. | Medium | High | Matching code, hold-to-confirm, request details, single-use sessions. |
| R4 | Relay abused as free file hosting. | Medium | Medium | Size and TTL caps, gated download, rate limits, challenge, abuse contact. |
| R5 | Operator serves malicious viewer code (the usual limit of web E2E). | Low | High | Open source, published hashes, reproducible builds, self-hosting for high assurance. |
| R6 | iOS PWA limits (no share target, restricted background and push). | High | Low | File picker flow, clear docs, native wrapper later. |
| R7 | Office rendering mismatches (fonts, layout). | High | Medium | Show preview before locking, fidelity labels, optional full-fidelity engine. |
| R8 | Shop printer or copier drive retains the job. | Medium | Medium | Document it. Prefer phone-direct mode for printers without storage. Watermark reduces value. |
| R9 | Legal exposure for operators of a public E2E relay. | Low | Medium | Short TTL, caps, takedown contact, legal advice before launching a public instance. |

## 13. Open decisions

1. **License:** Apache-2.0 (maximum adoption) or AGPL-3.0 (blocks closed hosted forks). Some optional converters (Ghostscript) are AGPL and must stay as separate plugins under Apache-2.0.
2. **Public instance:** launch one at v0.1, or ship self-host only until abuse controls are proven.
3. **Platform for the public instance:** Cloudflare (cheapest, see COSTING.md) or AWS (most familiar to the maintainer).
4. **Name and domain:** run trademark, GitHub and domain checks on "Despawn" before publishing.
5. **Languages beyond English and Hindi** and who reviews translations.
6. **Native wrappers** (Capacitor) and the timing for iOS.

## 14. Prior art and differentiation

Burn-after-read and one-time-link tools (for example Cryptgeon, BurnLink, and similar) deliver a note or file to a recipient who can usually save it. Despawn differs in four ways: the recipient is a print terminal that never receives a file, the owner approves live with a code match, the viewer wipes itself on a dead-man's switch, and output is purpose-watermarked and revocable. Verify the current landscape before claiming novelty in public messaging.
