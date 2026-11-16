# Despawn: Session state machine

Implemented in `packages/protocol/src/machine.ts`. `reduce(model, event)` is **pure and total**: it never mutates its input, never throws, reads no clock and performs no I/O. It returns the next model plus an ordered list of declarative **effects** that the relay executes. Timers are effects (`START_TIMER`, `CANCEL_TIMER`) and events (`TIMER`).

## 1. States

`CREATED`, `ARMED`, `AWAITING`, `RELEASED`, `LIVE`, and the terminal states `DESTROYED`, `EXPIRED`, `CANCELLED`, `ABORTED`. `DRAFT` exists only on the owner's phone.

## 2. Model

| Field | Meaning |
|---|---|
| `state` | One of the states above |
| `rules` | `linkTtlMs`, `liveTtlMs`, `printLimit`, `graceMs`, `destroyAfterPrint` |
| `pending` | Request ids awaiting the owner. Non-empty only in `AWAITING` |
| `approvedReqId` | The one request the owner approved. Kept in terminal states |
| `printsDone`, `printing` | Completed prints and whether a print is in progress |
| `shopReportedWipe` | The shop page reported that it wiped itself (self-reported) |
| `terminalReason` | Set exactly in terminal states |

## 3. Events

`UPLOADED`, `SHOP_HELLO{reqId}`, `SHOP_REQUEST_DROPPED{reqId}`, `OWNER_APPROVE{reqId}`, `OWNER_DENY{reqId}`, `OWNER_KILL`, `OWNER_LOST`, `SHOP_RENDERED`, `SHOP_PRINT_STARTED`, `SHOP_PRINTED`, `SHOP_WIPED{reason}`, `SHOP_LOST`, `TIMER{upload|link|release|live|grace}`.

The relay only feeds `SHOP_*` events that came from the approved shop's socket. `OWNER_LOST` and `SHOP_LOST` mean no heartbeat or connection for `HEARTBEAT_TIMEOUT_MS`.

## 4. Transitions

Anything not listed is ignored (stale timers, `OWNER_LOST` before release) or answered with a `DROP_MESSAGE` effect (wrong-state messages are dropped and logged without content).

| From | Event | To | Notes |
|---|---|---|---|
| CREATED | UPLOADED | ARMED | cancel `upload`, start `link` timer |
| CREATED | TIMER upload | EXPIRED | reason `LINK_EXPIRED` |
| CREATED, ARMED, AWAITING | OWNER_KILL | CANCELLED | reason `CANCELLED` |
| CREATED | SHOP_HELLO | CREATED | reject `NOT_FOUND` |
| ARMED | SHOP_HELLO | AWAITING | `pending = [reqId]`, notify owner |
| ARMED, AWAITING | TIMER link | EXPIRED | reason `LINK_EXPIRED` |
| AWAITING | SHOP_HELLO | AWAITING | append, or reject `TOO_MANY_REQUESTS` at the cap |
| AWAITING | SHOP_REQUEST_DROPPED | AWAITING or ARMED | `requestGone` to owner |
| AWAITING | OWNER_DENY | AWAITING or ARMED | deny that shop |
| AWAITING | OWNER_APPROVE | RELEASED | deny all others, `RELEASE_TO_SHOP`, start `release` timer |
| AWAITING | OWNER_APPROVE or OWNER_DENY with unknown id | same | drop `UNKNOWN_REQUEST` |
| RELEASED | SHOP_RENDERED | LIVE | cancel `release`, start `live` timer |
| RELEASED | TIMER release | ABORTED | reason `RELEASE_TIMEOUT` |
| RELEASED, LIVE | SHOP_LOST, OWNER_LOST | ABORTED | reason `HEARTBEAT_LOST` |
| RELEASED, LIVE | OWNER_KILL | DESTROYED | reason `OWNER_KILLED` |
| RELEASED, LIVE | SHOP_WIPED | DESTROYED | reason `SHOP_WIPED`, `shopReportedWipe = true` |
| RELEASED, LIVE | SHOP_HELLO | same | reject `WRONG_STATE` (links are single use) |
| RELEASED, LIVE | OWNER_APPROVE, OWNER_DENY | same | drop (a session is approved at most once) |
| LIVE | SHOP_PRINT_STARTED | LIVE | `printing = true`, or drop if already printing or at the limit |
| LIVE | SHOP_PRINTED | LIVE or DESTROYED | `printsDone + 1`. If `destroyAfterPrint` and the limit is reached: start `grace`, or destroy at once when `graceMs = 0` |
| LIVE | TIMER grace | DESTROYED | only if the limit is reached and `destroyAfterPrint`. Reason `PRINTED` |
| LIVE | TIMER live | DESTROYED | reason `LIVE_TIMEOUT` |
| terminal | SHOP_HELLO | same | reject `NOT_FOUND` |
| terminal | SHOP_WIPED (first) | same | set `shopReportedWipe`, effect `SHOP_WIPE_CONFIRMED` |
| terminal | anything else | same | no effects |

## 5. Terminal effect order (exact)

Every transition into a terminal state emits, in this order:

1. `CANCEL_ALL_TIMERS`
2. `DELETE_BLOB`
3. `REVOKE_BLOB_TOKENS`
4. `SEND_SHOP_KILL` for the approved shop (if any), then each pending shop in order
5. `SEND_OWNER_DESTROYED`
6. `WRITE_TOMBSTONE`

## 6. Invariants (checked by `checkInvariants` and by property tests)

- `pending` is non-empty exactly in `AWAITING`, holds no duplicates and never exceeds `MAX_PENDING_REQUESTS`.
- `RELEASED` and `LIVE` have an `approvedReqId`. It is never set before approval.
- `RELEASE_TO_SHOP` is emitted at most once per session.
- `printsDone <= printLimit`, and `printing` is only true in `LIVE`.
- `terminalReason` is set exactly in terminal states. Terminal states never change state.
- `DELETE_BLOB` is emitted exactly once, on the transition into a terminal state.
- Every non-terminal state has a timer that eventually ends the session.

## 7. Notes

- `SHOP_PRINTED` means the shop operator confirmed the print finished. Browsers fire `afterprint` for a cancelled dialog too, so the viewer asks "Did it print?" before sending `printed`.
- The reducer does not know blob tokens or message payloads. The relay owns those and executes `RELEASE_TO_SHOP` by building the `released` message from the owner's `approve` fields.
