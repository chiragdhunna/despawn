# Despawn: Self-hosting

One small Node process serves the relay API, the owner app (`/app/`) and the shop viewer (`/s/<id>`). Ciphertext is kept for minutes and can live in RAM only. There is no database and no account system.

## Requirements

- Docker (or Node 22 and pnpm 10 to run from source).
- **HTTPS.** Browsers only expose WebCrypto on secure pages, so Despawn works on `https://` and on `http://localhost`, but **not** on `http://192.168.x.x` or any plain-HTTP address. Put a TLS reverse proxy in front for real use.

## Quick start (Docker)

```bash
git clone https://github.com/chiragdhunna/despawn
cd despawn
docker compose up -d --build
# open http://localhost:8080/ on the same machine to try it
```

The compose file binds to `127.0.0.1:8080`, keeps ciphertext on a RAM-backed `tmpfs`, runs read-only, drops all capabilities and sets `TRUST_PROXY=true` (only correct when a proxy you control is in front).

## HTTPS with Caddy (example)

```
despawn.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Caddy gets and renews the certificate on its own and forwards WebSockets without extra settings. Any proxy works if it forwards `Upgrade` headers and sets `X-Forwarded-For`.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT`, `HOST` | `8080`, `0.0.0.0` | Listen address |
| `OWNER_DIST`, `VIEWER_DIST` | set in the image | Built apps to serve |
| `BLOB_DIR` | `/data/blobs` | Where ciphertext is stored. Leave unset to keep it in process memory |
| `TRUST_PROXY` | `false` | Trust `X-Forwarded-For` and `CF-IPCountry` from a proxy you control |
| `MAX_BLOB_BYTES` | `26214400` | Largest upload (25 MiB) |
| `MAX_SESSIONS_PER_DAY` | `10000` | Global daily cap |
| `MAX_ACTIVE_SESSIONS` | `1000` | Sessions alive at once |

Per-client limits (20 session creations a minute, 40 sockets) are options of `startServer` and can be changed in `adapters/node/src/main.ts`.

## From source

```bash
pnpm install --frozen-lockfile
pnpm build
OWNER_DIST=$PWD/apps/owner/dist VIEWER_DIST=$PWD/apps/viewer/dist PORT=8080 node adapters/node/dist/main.mjs
```

## What the server keeps

Encrypted bundles (deleted when downloaded, when the session ends, or when the process restarts), session state in memory, and short-lived rate-limit counters keyed by a salted hash of the client address. Logs are structured events with no content, file names, keys or tokens. The server cannot decrypt anything: the key only ever travels from the owner's phone to the approved shop browser.

## Operating notes

- A restart ends every session and deletes leftover ciphertext (fail closed).
- Run one instance. Sessions live in memory, so there is no shared state between instances.
- Back up nothing. There is nothing worth keeping.
- If you serve a public instance, publish a privacy notice and add an abuse contact. The relay cannot inspect content, so rely on the size, time and rate limits.
- The Dockerfile and compose file are untested builds on the author's machine. Report problems.
