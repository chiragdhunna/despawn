# Despawn: Costing

All figures are in USD, at list prices checked in November 2026. Cloud prices and free tiers change, so confirm them before committing. Usage figures are **planning estimates** and must be measured in Phase 0 and 1 (see section 8).

## 1. Summary

| Scenario | Cash cost |
|---|---|
| Building and developing | **$0** (GitHub, CI, local tooling are free for public repos) |
| Public instance at launch (up to roughly 600 sessions a day) | **$0 to $2 a month** (free tiers plus a domain) |
| Public instance with headroom (Workers Paid) | **about $5 a month**, about **$25 a month at 100,000 sessions** |
| Self-hosted on one small VPS | **about $5 to $6 a month flat** |
| Domain | **about $10 to $20 a year** |
| Optional app-store listings | **$25 once** (Google Play), **$99 a year** (Apple) |

The real cost of an open-source project is maintainer time, not infrastructure. The design keeps infrastructure near zero because no accounts, no databases of user data, no file storage beyond minutes, and no third-party services are needed.

## 2. What drives cost

Despawn stores almost nothing and for a very short time. Costs come from three things:

1. **Connection time:** keeping the session coordinator awake while the shop page sends heartbeats (about 2 minutes per print).
2. **Data transfer:** the ciphertext download, about 3 MB for a typical ID or a few pages.
3. **Requests:** a few dozen small messages per session.

There are no user accounts, no long-term storage, no analytics service, no email, no payments, and no AI inference.

## 3. Planning assumptions

| Assumption | Value |
|---|---|
| Average ciphertext per session | 3 MB (max 25 MB) |
| Live time per session | 2 minutes, heartbeat every 2 seconds |
| Owner connected while waiting | about 10 minutes (idle) |
| Workers requests per session | about 5 |
| Durable Object billed requests per session | about 8 (WebSocket messages are billed at 20 to 1) |
| Durable Object compute per session | about 20 GB-seconds (128 MB, about 2.5 minutes awake) |
| Blob lifetime | minutes (deleted on download or end), 24 h lifecycle backstop |

## 4. Option A: Cloudflare (recommended for the public instance)

Stack: Pages (static apps), Workers, Durable Objects (SQLite-backed, WebSocket Hibernation), R2 (ciphertext), Turnstile (abuse challenge).

### 4.1 Pricing inputs

| Item | Free plan | Paid (Workers Paid, $5 a month) |
|---|---|---|
| Durable Objects (SQLite-backed) | 100,000 requests a day, 13,000 GB-s a day, 5 GB storage | 1M requests and 400,000 GB-s a month included, then $0.15 per million requests and $12.50 per million GB-s |
| Workers | 100,000 requests a day | 10M requests a month included |
| R2 | 10 GB-month storage, 1M Class A and 10M Class B operations a month | $0.015 per GB-month, $4.50 per million Class A, $0.36 per million Class B |
| R2 egress | Free | Free |
| Pages and static assets | Free | Free |
| Turnstile | Free | Free |

On the free plan, usage beyond a limit fails until the limit resets, so the service can go down on a traffic spike. That is the reason to move to the paid plan once the project has real users.

### 4.2 Estimated monthly cost by volume

| Sessions a month | Duration cost | Request and R2 cost | Plan | **Estimated total** |
|---|---|---|---|---|
| 1,000 | within free | within free | Free | **$0** |
| 10,000 | within free (about 330 a day) | within free | Free (or Paid for safety) | **$0 to $5** |
| 100,000 | 2M GB-s, minus 0.4M included, about $20 | within included | Paid | **about $25** |
| 1,000,000 | 20M GB-s, about $245 | about $6 | Paid | **about $255** |

How to read it: on the free plan the duration cap (13,000 GB-s a day at about 20 GB-s per session) allows roughly 650 sessions a day, which is about 19,000 a month. Duration is the dominant cost at scale. If heartbeats keep the coordinator awake the whole live phase (as assumed), Hibernation does not cut cost much. Lengthening the heartbeat interval or batching ticks can. Without Hibernation at all, duration could be several times higher, so use it.

### 4.3 Pros and cons

| Pros | Cons |
|---|---|
| Lowest cost for small and medium volume, zero egress fees, static hosting and challenge included | Platform-specific code in one adapter (the rest is portable) |
| Global edge, low latency for WebSockets | Free plan hard limits, so plan for the paid plan |

## 5. Option B: AWS serverless

Stack: API Gateway WebSocket, Lambda, DynamoDB (on-demand), S3, CloudFront or Amplify for static files.

### 5.1 Per-session estimate (US East list prices, Mumbai differs slightly)

| Item | Basis | Cost |
|---|---|---|
| API Gateway WebSocket messages | about 220 messages at $1.00 per million | $0.00022 |
| API Gateway connection minutes | about 20 at $0.25 per million | $0.000005 |
| Lambda | 220 invocations, about 30 ms at 128 MB | $0.00006 |
| DynamoDB writes | about 10 at $1.25 per million | $0.00001 |
| S3 requests | 1 PUT, 1 GET | $0.00001 |
| Data transfer out | 3 MB at $0.09 per GB | $0.00027 |
| **Total** | | **about $0.0006 per session** |

### 5.2 Estimated monthly cost by volume

| Sessions a month | Estimated total |
|---|---|
| 1,000 | about $0.60 |
| 10,000 | about $6 |
| 100,000 | about $55 (some data transfer and Lambda usage is free) |
| 1,000,000 | about $570 |

### 5.3 Free tier note

AWS changed its free tier for accounts created from 15 July 2025: new accounts get a credits-based plan (up to $200 in credits and a six-month free plan) instead of the old twelve-month service allowances. An older account may keep legacy terms. Check which applies before budgeting.

### 5.4 Pros and cons

| Pros | Cons |
|---|---|
| Familiar to many teams, mature tooling, scales without limits | Egress and API Gateway message fees make it roughly twice the cost of Cloudflare at 100,000 sessions |
| Good for organizations already on AWS | More moving parts to configure (IAM, WebSocket routes, DynamoDB TTL) |

## 6. Option C: Self-host (Docker on a VPS or home server)

| Item | Cost |
|---|---|
| Small VPS (1 to 2 vCPU, 1 to 2 GB RAM) | **about $5 to $6 a month**, flat |
| Home server or Raspberry Pi behind a free tunnel | **$0** plus electricity, subject to your ISP's terms |
| Bandwidth | Many budget VPS plans include several terabytes a month. Check yours. At 100,000 sessions the transfer is about 300 GB |
| Backups | Not needed for session data (it is deliberately ephemeral). Keep config in git. |

One small instance comfortably handles tens of thousands of sessions a month. The Node adapter keeps session state in memory with optional SQLite recovery, so there is no database to manage.

## 7. Fixed and optional costs

| Item | Cost | Notes |
|---|---|---|
| Source hosting, issues, CI | $0 | GitHub is free for public repositories, including standard Actions runners |
| Static hosting | $0 | Cloudflare Pages or GitHub Pages |
| Domain | about $10 to $20 a year | Price varies by extension and registrar, check before buying |
| Abuse challenge | $0 | Cloudflare Turnstile, or proof-of-work for self-hosters |
| Error monitoring | $0 | Not used by design. Counters only, no third-party telemetry |
| Google Play listing | $25 once | Only if shipping a native wrapper |
| Apple Developer Program | $99 a year | Only if shipping a native wrapper. The PWA needs neither |
| Independent security review | Quotes vary widely | Start with community review plus automated scanning (CodeQL, OSV). Budget a paid review only if the project is adopted for sensitive use |
| Transactional services (email, SMS, push) | $0 | Web Push is free. No email or SMS is used |

## 8. Year-one budget scenarios

| Scenario | Monthly | Year one total |
|---|---|---|
| **Minimal.** Free tiers, small public instance | $0 | **$10 to $20** (domain only) |
| **Typical.** Workers Paid, up to about 20,000 sessions a month | $5 | **about $75 to $80** |
| **Growing.** About 100,000 sessions a month on Cloudflare | about $25 | **about $320** |
| **Growing on AWS.** About 100,000 sessions a month | about $55 | **about $680** |
| **Self-host only (no public instance).** One VPS | $5 to $6 | **about $75 to $90** |

Add $124 in the first year if you ship native wrappers to both stores.

## 9. Keeping costs under control

Public relays are abusable, and most platforms do not stop spending automatically. Protect the budget in the app:

| Control | Setting |
|---|---|
| Ciphertext size cap | `MAX_BLOB_BYTES` (default 25 MB) |
| Link validity cap | `MAX_LINK_TTL` (default 24 h) |
| Sessions per day, global | `MAX_SESSIONS_PER_DAY` (set well above normal use, alert on 80%) |
| Per-IP rate limit | Salted, rotating IP hash, short TTL |
| Challenge on session creation | Turnstile or proof-of-work |
| Download gating | Ciphertext is released only after the owner approves, and only once |
| Provider alerts | Billing and usage notifications at low thresholds |

An attacker who creates sessions still costs very little per session. The caps exist so that cost cannot run away.

## 10. Measure, then update this document

Phase 0 and 1 should produce real numbers for:

1. Durable Object GB-seconds per session, with and without Hibernation, and with different heartbeat intervals.
2. Messages per session (billed WebSocket requests).
3. Average and 95th percentile ciphertext size by document type and DPI.
4. Real concurrency (how many sessions overlap), which drives blob storage and memory.

Replace the estimates above with measured values, and add a small script (`infra/cost-model`) that recomputes the table from those inputs and current prices.

## 11. Funding a free project

| Source | Notes |
|---|---|
| GitHub Sponsors and Open Collective | Simple, low overhead, good for covering hosting |
| Donations link on the public instance | Fits the "free for individuals" promise |
| Cloud provider open-source credits | Several providers run programmes for open-source projects. Apply after the project has users |
| Grants for privacy and open-source infrastructure | Worth tracking once v1.0 and a security review exist |
| Optional paid support or hosted instance for businesses (for example print shops that want a branded verified-printing page) | Keeps the core free. A possible later option, not part of v1 |

## 12. Recommendation

1. Develop and demo on the free tiers. Budget about $12 to $20 for a domain.
2. Launch the public instance on Cloudflare with caps and a challenge, and move to Workers Paid ($5 a month) as soon as daily use approaches 400 sessions.
3. Publish the Docker Compose self-host guide at the same time, so anyone can run their own instance for about $5 a month.
4. Keep an AWS adapter as a community-maintained option rather than the default.
5. Revisit this document after Phase 1 with measured numbers.
