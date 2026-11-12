<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo/logo-dark.svg">
    <img alt="Despawn" src="assets/logo/logo-light.svg" width="360">
  </picture>
</p>

<p align="center"><b>Your document gets one life.</b><br>Print at any shop, keep nothing behind.</p>

<p align="center">
  <i>Status: pre-alpha, planning. No installable release yet.</i>
</p>

---

## The problem

You need to print your PAN card, Aadhaar, passport or a bank statement at a photocopy shop. You send the file over WhatsApp, the shopkeeper prints it, and the file stays in his Downloads folder, his WhatsApp backup and his recycle bin. You can ask him to delete it, but you cannot check, and you will be at a different shop next time.

## The idea

**Never hand the shop a file. Hand it a link that is dead unless you approve it live from your phone.**

1. On your phone, Despawn flattens the document into page images, bakes in a purpose watermark, and encrypts everything with a key that never leaves your phone.
2. You give the shop a link (WhatsApp is fine, the link carries no file and no file key).
3. The shop opens the link in any browser. Nothing to install, no account.
4. Your phone shows who is asking and a 4-digit code. You compare it with the shop screen and approve.
5. Your phone sends the key straight to that browser tab. The page decrypts in memory only and shows a **Print** button.
6. After printing, or when you tap **Destroy**, or when the timer ends, or if your phone goes offline, the page wipes itself and the server deletes the ciphertext.

## What Despawn guarantees

- The shop never receives a file. There is no download button, nothing is written to disk by the page, and the link is useless without your live approval.
- You hold the only key and a kill switch for the whole session.
- Anything that does leak (a screenshot, "Save as PDF" from the print dialog) is a watermarked image stamped with your purpose, the date and a session ID, and can be marked revoked.

## What it cannot guarantee

No software can stop a camera pointed at a screen or a page, because printing needs the pixels. Despawn removes every digital trace a shop would normally keep, shrinks the exposure window to about a minute, and makes whatever escapes low-value. It does not claim more than that. See the threat model in [ARCHITECTURE.md](docs/ARCHITECTURE.md#2-threat-model).

## Documentation

| Document | What it covers |
|---|---|
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | Vision, constraints, personas, functional and non-functional requirements, acceptance criteria, release phases |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Threat model, components, crypto protocol, session state machine, API, repo layout, deployment, decisions |
| [docs/FILE_SUPPORT.md](docs/FILE_SUPPORT.md) | How any file format becomes printable pages, support matrix, fidelity levels, limits |
| [docs/UI_DESIGN.md](docs/UI_DESIGN.md) | Brand, logo, design tokens, components, every screen with wireframes, copy, accessibility |
| [docs/COSTING.md](docs/COSTING.md) | Running costs for a free, open-source deployment at different scales |
| [design/tokens.css](design/tokens.css) | Design tokens, ready to import |
| [assets/logo/](assets/logo/) | Logo set (SVG) and the script that generates it |

## Planned stack

TypeScript monorepo. Owner app: installable PWA (React, Vite, WebCrypto, pdf.js). Shop viewer: tiny framework-free page. Server: portable core with adapters for Node/Docker (self-host), Cloudflare Workers with Durable Objects and R2 (public instance), and AWS serverless (community).

## Roadmap

| Phase | Goal |
|---|---|
| 0. Spike | Encrypted handshake, PDF render, print on a real shop-style PC |
| 1. MVP (v0.1) | PDF and images, watermark, ID-card layout, live approval, destroy, self-host |
| 2. v0.2 | Office/HEIC/TIFF/text, masking, page editing, Hindi UI, phone-direct print |
| 3. v0.3 | Verification QR and revoke, archives, video frames, optional full-fidelity converter |
| 4. v1.0 | Hardening, reproducible builds, external review, auto-mask via on-device OCR |

## Prior art

Burn-after-read tools such as Cryptgeon and BurnLink hand a recipient a note or file that disappears after viewing. Despawn targets a different case: the recipient needs to print, not keep, and the owner stays in the loop live. Check current projects before claiming novelty.

## Development

### Prerequisites
- Node.js >= 22 (see `.nvmrc`)
- pnpm 10.x

### Install
```bash
pnpm install
```

### Commands
- `pnpm build`: Build all packages and applications
- `pnpm lint`: Lint all workspace code
- `pnpm format`: Format files using Prettier
- `pnpm format:check`: Check formatting with Prettier
- `pnpm typecheck`: Run TypeScript type-checking across workspace
- `pnpm test`: Run test suites with Vitest
- `pnpm clean`: Clean build artifacts and caches

### Folders
- `apps/` contains web applications (`owner` PWA and `viewer` shop interface); `packages/` contains shared protocol, crypto, bundle, render, compose, ui, and server core logic.
- `adapters/` hosts platform adapters (Node, Cloudflare, AWS); `docs/` and `design/` hold system specifications and visual design tokens.

## Contributing, security, license

- Contributions welcome once the repo opens for code. Start with the docs and open an issue to discuss.
- Report vulnerabilities privately (a `SECURITY.md` will describe the channel before v0.1).
- License: **Apache-2.0 proposed**, final choice pending (see open decisions in REQUIREMENTS.md).
