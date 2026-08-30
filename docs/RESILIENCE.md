# KisanPool — Resilience, Recovery & The Blackout

How KisanPool survives a data-store incident, what each layer is actually for, and
what a human still has to do. Implementation: `apps/server/src/modules/resilience/`.
Decision records: `docs/DECISIONS.md` ADR-044 (the architecture) and ADR-045 (the
continuity reads and deferred intent that connect it to the app).

---

## 1. The distinction everything else follows from

Two incidents look similar from the outside and need opposite responses. Confusing
them is the failure this whole layer exists to prevent.

| | **Infrastructure failure** | **Data loss / corruption** |
|---|---|---|
| What happened | A node died; the primary stepped down | The data itself is gone, wrong or unreadable |
| Is the data OK? | **Yes** | **No** |
| Does replication help? | **Yes** — Atlas elects a new primary in seconds | **No** — replication faithfully copies the damage to every member |
| Right response | **Wait.** The driver retries; it heals itself | **Restore** to a point in time before the damage |
| Handled by | Replica set + majority writes + retryable writes | Continuous Cloud Backup + PITR |
| Our state | `DEGRADED` → self-heals inside the debounce | `RECOVERY_REQUIRED` (kind `DATA_INTEGRITY`) |

> **Replication is for availability. Backup/PITR is for disaster recovery.**
> A system that treats corruption like an outage waits forever. A system that
> treats an outage like corruption restores a database that was never broken.

The detector diagnoses them differently on purpose:

- **unreachable, repeatedly** → `INFRASTRUCTURE`. `ping` fails past the threshold.
- **reachable but unreadable** → `DATA_INTEGRITY`. `ping` succeeds, but a read of
  the core collections throws. A failover cannot fix this, so it is never waited out.

---

## 2. The layers, and what each is allowed to be trusted for

```
                         KISANPOOL
                             │
                     MongoDB Atlas  ── AUTHORITATIVE, always
                             │
              ┌──────────────┴──────────────┐
        Replica set (HA)            Continuous Backup + PITR
        node crash → failover       corruption/delete → restore
                             │
                    Recovery Controller
                             │
         ┌───────────────────┴───────────────────┐
   Operational snapshots              Recovery journal
   last-known READ state              durable append-only INTENT
   display only, expiring             survives the DB being gone
         └───────────────────┬───────────────────┘
                    replay → reconcile → validate
                             │
                   rebuild snapshots from Mongo
                             │
                       NORMAL OPERATION
```

| Layer | Holds | Trusted for | Losing it costs |
|---|---|---|---|
| **MongoDB Atlas** | Everything | **Everything.** The system of record | The incident |
| **Snapshots** | Trip state, last position, ETA, capacity | **Display only**, stamped "as of" | Freshness |
| **Journal** | Intent for critical mutations | Reconciliation after an incident | The ability to know what was in flight |
| **Payment provider** | Money | **Money.** Its signed webhook is authoritative | — |

**The rule that governs all of it:** an operation is only ever reported as done
when MongoDB — or, for money, the payment provider — says it is done. A journalled
intent is a promise to try, not a receipt.

---

## 3. Redis: optional, mirror-only, and durable only when it proves it

Redis is **entirely optional**. With no `REDIS_URL` the application runs exactly as
before; snapshots use an in-process store and the journal uses a local fsync'd file.

### The file is the floor; Redis is a mirror

Intent is **always** appended to the fsync'd file, and *additionally* mirrored to
Redis when Redis has proved it persists. Reads come from the file, which is local
and always complete.

The tempting alternative — "use Redis when it is there, the file when it is not" —
splits the pending queue across two stores the moment anyone toggles Redis, and
reconciliation then silently sees half of it. **A journal you can lose half of by
restarting a cache is not a journal.** This is also what makes the admin panel's
Redis switch safe.

The mirror still earns its place: a second application instance can read it, which
a local file can never offer.

### Durability is asked about, not assumed

```
REDIS_DURABILITY=auto (default)
  CONFIG GET appendonly →  "yes"     →  REDIS_AOF         mirrors the journal
                        →  "no"/none →  REDIS_CACHE_ONLY  snapshots only
                        →  denied    →  REDIS_CACHE_ONLY  unverifiable ≠ verified

REDIS_DURABILITY=durable   operator asserts the provider persists → mirrors
REDIS_DURABILITY=cache     never trusted with intent, whatever it reports
```

A default cache-mode Redis acknowledges a write, keeps it in memory, and **can lose
it on restart** — fine for a cached ETA, catastrophic for a pending booking.

**Managed providers need the override.** Upstash, ElastiCache and Memorystore are
genuinely durable but do not run standard Redis AOF, so they answer
`CONFIG GET appendonly` with nothing, `no`, or a refusal. Under `auto` they are
therefore classified `REDIS_CACHE_ONLY` — safe, but an under-statement. Set
`REDIS_DURABILITY=durable` to correct it. That has to be a deliberate act rather
than an inference: the cost of guessing wrong is a lost booking.

The board shows the backend, whether it is durable, and *why* — never implied.

---

## 4. Failure matrix

| # | MongoDB | Redis | Behaviour |
|---|---|---|---|
| 1 | Healthy | Healthy | Normal. Snapshots written on the read path; intent journalled on critical writes |
| 2 | **Down** | Healthy | `RECOVERY_REQUIRED`. Reads served from snapshots with a timestamp. **Irreversible writes refused with a reason** — and the three replayable creations are *journalled first*, so the refusal says "saved, not confirmed" (§4a) |
| 3 | Healthy | **Down** | `DEGRADED`. Snapshots fall back to the in-process store, journal to disk. **Everything keeps working** |
| 4 | **Down** | **Down** | `RECOVERY_REQUIRED`. Writes refused. The journal is still durable (local fsync'd file), so nothing in flight is lost |

**Case 2 is the one with the trap.** The tempting behaviour is to accept the booking
into Redis and tell the farmer it worked. It did not work: nobody reserved the
capacity, no money moved, and the truck may already be full. Telling someone their
produce is on a lorry when it is not is worse than telling them to try again in a
minute. So writes are **refused**, with `EXTERNAL_SERVICE_ERROR` and a message that
says nothing has been lost.

---

## 4a. Continuity reads, and deferred intent (ADR-045)

Case 2 has two halves, and until ADR-045 neither was actually wired: nothing read
the snapshots, and `requireWritable` refused ahead of the handler so the service's
own `recordIntent` never ran. The pending queue stayed empty for the whole
incident and every applier in `recovery.ts` was unreachable code.

### Reads: cache-aside, which is also how Redis stays current

```
okOrLastKnown(res, key, load)
   │
   ├─ MongoDB answers  →  serve it, and leave a snapshot behind
   ├─ store failure + snapshot  →  serve the snapshot + `X-Data-As-Of`
   └─ store failure + no snapshot  →  rethrow. An empty list is a lie
```

There is deliberately no second set of write hooks feeding the cache. Populating
it from the read models means the snapshot is by construction the exact shape the
screen renders, and it cannot drift out of step with it. Historical and completed
data is never cached — only what a live screen asked for.

`isStoreFailure` is the safety boundary. A 404, a 403 or a validation error is a
real, correct answer and is returned unchanged: serving a cached trip to someone
who has just been removed from it would be a security bug, not continuity.

Covered: farmer requests and request detail · shipments · trip detail · live
track (last position + ETA) · driver trips, offers and the pool · machinery
bookings · backhaul requests · return-leg state.

### Writes: refused, but journalled first where that is honest

| Operation | During an outage |
|---|---|
| Transport request · machinery booking · backhaul acceptance | **Deferred.** Intent journalled durably under the id the replay will use; the response is still a failure, with the reference |
| Any state transition, capacity change, OTP-gated step | **Refused.** They cannot be validated without the database, and journalling an intent nobody validated is a promise we have no right to make |
| Anything touching money | **Refused, flatly.** A payment is never deferred |

The response for a deferred operation is the same `EXTERNAL_SERVICE_ERROR`
envelope every client already handles. That is deliberate: the operation was
*preserved*, not performed — no capacity reserved, no price fixed, nothing
confirmed — so a success envelope would be precisely the lie this layer exists to
prevent. The message says it was saved and carries the reference.

**The idempotency anchor is minted at deferral time.** The route generates the
`_id` the replay will create the record under, so a second replay collides with
the primary key (and with `TripShipment.requestId` / `BackhaulBooking.requestId`)
and cannot double anything.

---

## 5. Recovery states

| State | Meaning | Writes |
|---|---|---|
| `HEALTHY` | Nominal | ✅ |
| `DEGRADED` | A dependency is unhappy but the DB answers (incl. an in-progress failover) | ✅ |
| `RECOVERY_REQUIRED` | Confirmed incident: unreachable past threshold, or data unreadable | ⛔ |
| `RESTORING` | Point-in-time restore under way (operator-driven) | ⛔ |
| `RECONCILING` | DB back; pending journal intent being replayed | ⛔ |
| `VALIDATING` | Integrity checks running | ✅ |
| `RECOVERED` | Validation **passed**; snapshots rebuilt | ✅ |
| `MANUAL_REVIEW` | Recovery ran but something could not be resolved safely | ✅ |

**Detection is debounced.** A failure must persist across `RECOVERY_FAILURE_THRESHOLD`
consecutive probes (default 3, every 10s) before the state escalates. That window is
deliberately about the length of an Atlas election — so an infrastructure failure
heals itself inside the debounce and never reaches the operator at all.

`RECOVERED` is only reached when integrity **actually passed** and no journalled
operation was left unresolved. Otherwise it is `MANUAL_REVIEW`. The board never
prints a green tick it has not earned.

---

## 6. The recovery journal

Durable, append-only, and stored **outside the database it protects**. A journal
inside the thing it is protecting against is not a journal.

**Event schema** (`packages/shared/src/resilience.ts`):

```
eventId         uuid
eventType       REQUEST_CREATED | TRANSPORTER_SELECTED | SHIPMENT_STATE_CHANGED |
                TRIP_STATE_CHANGED | PRICING_RECALCULATED | PAYMENT_STATE_CHANGED |
                PAYOUT_STATE_CHANGED | MACHINE_BOOKING_* | BACKHAUL_BOOKING_* | …
entityType      Trip | TripShipment | Payment | …
entityId        the record it concerns
actorId         who asked for it (null for system actions)
operationKey    sha256(eventType:entityId:discriminator) — the idempotency anchor
payload         only what reconciliation needs. NO secrets, OTPs, tokens or bank details
state           PENDING → COMMITTED | REPLAYED | SUPERSEDED | ABANDONED
schemaVersion   1
recordedAt / committedAt / error
```

**Write-ahead order** (`withJournal`, or `recordIntent` → work → `markCommitted`):

1. Derive the operation key
2. Append `PENDING` intent, **fsync**
3. Attempt the MongoDB write
4. Append `COMMITTED` once the authoritative store confirms
5. If the DB is unavailable, the entry simply stays `PENDING`
6. After recovery, replay settles it

**Append-only, including state changes.** Marking an event committed appends a new
line for the same `eventId`; the current state of an event is the *last* line
mentioning it. A torn trailing line from a crash mid-append is discarded on read and
the previous state stands.

**Journal failures never fail a request.** A disk hiccup must not take down a booking
MongoDB is perfectly able to accept. The journal makes recovery possible; it is not
a precondition for serving.

---

## 7. Replay and idempotency

Replay does **not** re-execute business logic. Re-running "select transporter" would
re-price a trip, re-reserve capacity and possibly re-charge someone. It **verifies**:

> For each pending intent — does the effect already exist in the authoritative store?

| Result | Outcome |
|---|---|
| Effect present | `SUPERSEDED` — the write landed; only the confirmation was lost |
| Effect absent, and a safe applier exists | `REPLAYED` — re-driven through the **real** business service, under the original id, with all of its own validation |
| Effect absent, and the service **refuses** it | `ABANDONED`, carrying the service's own stated reason. A refusal is an answer |
| Effect absent, no safe applier | Reported for an operator to re-drive through the normal API. **Not reconstructed** |
| Unknown | Reported. Unknown ≠ absent |

**Why a refusal is abandoned rather than left pending.** A lost slot race or an
ineligible cargo used to record intent, fail its write, and stay `PENDING`
forever. Because `RECOVERED` requires zero unresolved entries, one lost race made
the board read `MANUAL_REVIEW` for the rest of the deployment's life — which
trains an operator to ignore it. Recording what the authoritative service actually
said is the same discipline as classifying an integrity finding instead of
repairing it: it is not silent, and it invents nothing.

That is the honest reading of "replay must be idempotent": **the safe outcome of
processing an event twice is that the second time changes nothing.**

Bookings, capacity and money are exactly the things that must not be conjured from a
log line — they go back through the real API with its own validation, or they wait
for a human. An operator can mark an entry `ABANDONED`, which **requires a reason**.

Idempotency is anchored on what an operation *is*, never on when it ran:
`sha256(eventType : entityId : discriminator)`. Two attempts at the same business
effect hash to the same key. Underneath, the domain's own constraints are the real
guarantee — e.g. the unique index on `TripShipment.requestId` means a request can
only ever ride once, whatever the journal says.

---

## 8. Integrity & reconciliation

Twelve read-only checks (`integrity.ts`). **Nothing is written.**

Users ↔ shipments · shipments ↔ trips · shipments ↔ requests · trips ↔ vehicles ·
vehicle capacity (overbooking) · pricing ↔ pricing history · payments ↔ shipments ·
payment split arithmetic · payments ↔ payouts · machinery ↔ bookings ·
backhaul ↔ trip legs · duplicate shipments

**Findings are classified, never silently repaired:**

| Class | Meaning |
|---|---|
| `AUTO_RECOVERED` | Intact, or derivable with no ambiguity |
| `RECONSTRUCTED` | Rebuilt from the journal or derived state, and it agrees |
| `INCONSISTENT` | Genuinely disagrees — surfaced, deliberately left alone |
| `MANUAL_REVIEW` | Ambiguous, and guessing would risk capacity or money |

An orphaned shipment could be repaired three ways — delete it, recreate the trip, or
reattach it elsewhere — and the three produce different capacity, different pricing
and different money. A checker that picks one silently has made an accounting
decision nobody reviewed.

---

## 9. Data classification during an incident

| Class | Source | Example |
|---|---|---|
| **A** | Restorable from backup/PITR | Everything in MongoDB |
| **B** | Reconstructable from the journal | Critical mutations in flight during the incident |
| **C** | Cached last-known snapshot — display only | Trip status, last position, ETA, capacity |
| **D** | Unrecoverable without a human | `MANUAL_REVIEW` findings; unresolved journal entries |

---

## 10. Recovery procedure

**Automatic (infrastructure):** primary steps down → driver retries (`retryWrites`)
→ Atlas elects a new primary → probe recovers inside the debounce → `RECONCILING`
→ replay finds everything `SUPERSEDED` → `RECOVERED`. Usually invisible.

**Operator-driven (data loss/corruption):**

1. Board shows `RECOVERY_REQUIRED`, kind `DATA_INTEGRITY`. Writes are refused; users
   see an honest banner.
2. **Restore in Atlas** — UI → Cluster → Backup → *Restore to a point in time*, or
   the Admin API. Choose a point **before** the damage; `lastKnownGoodAt` on the
   incident is the anchor. ⚠️ **This step is deliberately not automated** — see §12.
3. `POST /admin/resilience/recover` → `RECONCILING` → `VALIDATING` → snapshot rebuild.
4. Read the result. `RECOVERED` only if validation passed; otherwise `MANUAL_REVIEW`
   with the findings listed.

**Snapshots are cleared and rebuilt from the restored database, never merged with
it.** Stale continuity state is worse than none: it describes a world the restored
database may no longer agree with.

---

## 11. RPO / RTO

Honest figures, with their assumptions stated.

| Scenario | RPO (data loss) | RTO (time to serve) |
|---|---|---|
| Node failure / primary election | **0** — majority writes survive failover | ~10–30s, mostly invisible (retryable writes) |
| Redis loss | 0 — nothing authoritative is there | 0 — automatic fallback |
| Data corruption / deletion | Bounded by Atlas PITR granularity (**verify for your tier**) | Restore time (cluster-size dependent) + reconcile + validate |
| Process crash mid-write | 0 for committed writes; in-flight intent is journalled | Restart |

- **RPO 0 on failover** depends on `w: 'majority'`, which is now set explicitly.
- **RPO for corruption is Atlas's**, not ours — it is whatever your tier's PITR
  window and granularity provide. **This has not been measured here** (§13).
- RTO excludes the human decision of *which* point to restore to.

---

## 12. What is deliberately NOT automated

**The application never triggers an Atlas restore.** A point-in-time restore
overwrites a live database with an older state — an irreversible action whose
correct restore point depends on knowing *when* the damage began. That is a judgement
call, and an automated system that gets it wrong destroys good data to recover from
bad. It stays behind a human in the Atlas UI or Admin API. The controller runs
everything *after* the data is back, which is the part an application can own.

Likewise, ambiguous integrity findings are never auto-repaired (§8).

---

## 13. Verified vs. assumed

Being precise about this matters more than a confident summary.

**Verified live in `tests/12_resilience.py` (136 checks) and `tests/08_backhaul.py`:**

- ✅ 3-member replica set `atlas-13ab35-shard-0`, MongoDB 8.0.30, read from the cluster
- ✅ Outage detection, debounce, `RECOVERY_REQUIRED`, honest user messaging
- ✅ Corruption detected **differently** — reachable but unreadable
- ✅ Bookings, payments and machine holds **refused** during an incident
- ✅ Intent journalled durably (fsync'd file); no secrets in payloads
- ✅ Replay idempotent — no duplicate shipment, no price change
- ✅ `RECOVERED` only when integrity actually passed
- ✅ Simulation destroys nothing — data byte-identical before and after
- ✅ Operator controls unreachable with a marketplace token
- ✅ Snapshots rebuilt from the authoritative database
- ✅ **All four matrix cases driven end to end** — ON/ON, OFF/ON, ON/OFF, OFF/OFF
- ✅ **CASE 2 is usable**: eight warmed operational views still served with MongoDB
  gone, each stamped `X-Data-As-Of`, carrying the real last-known trip, price,
  capacity, last position and ETA
- ✅ **New critical operations survive the outage**: a transport request, a
  machinery booking and a backhaul acceptance all land in the pending queue while
  a payment order is flatly refused — and the queue is still durable in CASE 4
- ✅ After recovery: 3 replayed, 1 abandoned with the service's real reason, 0
  unresolved → `RECOVERED`; the deferred request and the machinery slot genuinely
  exist; a second replay adds no duplicate request and no duplicate hold
- ✅ Reads after recovery are fresh, never the pre-incident snapshot
- ✅ Return-leg open/advance and backhaul acceptance journalled and replay-safe

**NOT verified — assumed from documentation, or requires manual setup:**

- ⚠️ **Continuous Cloud Backup / PITR is not confirmed enabled.** It is a control-plane
  setting the driver cannot see, so the board reports `UNVERIFIED` rather than
  claiming it. **You must check this in the Atlas UI.**
- ⚠️ **No real restore has been performed.** The post-restore path is tested; the
  restore itself is not.
- ⚠️ **No real Atlas failover has been observed.** HA is inferred from the 3-member
  replica set, which is genuine, but a live election was not induced.
- ✅ **Redis HAS been exercised live** against a local `redis:7 --appendonly yes`:
  AOF confirmed, journal entries verified present in Redis *and* in Redis's own
  on-disk AOF file, and the runtime on/off switch proven (app keeps serving with
  Redis off, journal stays durable).
- ⚠️ **The configured Upstash instance is classified `REDIS_CACHE_ONLY` under
  `auto`** because it does not report `appendonly yes`. It is used for snapshots
  and is *not* trusted with intent unless `REDIS_DURABILITY=durable` is set. Its
  actual durability guarantees have not been independently verified here.
- ⚠️ The file journal is local to one process — correct for a single instance, but a
  multi-instance deployment should use AOF-backed Redis.

---

## 14. Configuration

All optional; every default is safe.

| Variable | Default | Purpose |
|---|---|---|
| `REDIS_URL` | *(unset)* | Optional cache + journal mirror. Absent = in-process snapshots, file journal |
| `REDIS_DURABILITY` | `auto` | `auto` trusts only AOF-confirmed Redis · `durable` asserts a managed provider persists (Upstash/ElastiCache/Memorystore) · `cache` never trusts it with intent |
| `RECOVERY_JOURNAL_FILE` | `.data/recovery-journal.log` | Durable journal path (gitignored) |
| `RECOVERY_FAILURE_THRESHOLD` | `3` | Consecutive failed probes before escalating |
| `RECOVERY_PROBE_INTERVAL_MS` | `10000` | Health probe interval |
| `RECOVERY_SNAPSHOT_TTL_SECONDS` | `900` | How long a snapshot stays presentable |
| `ALLOW_PROD_SIMULATION` | *(unset)* | Required to run fault simulation with `NODE_ENV=production` |

**For durable Redis**, AOF must be on — Redis will not persist otherwise:

```bash
docker run -d --name kisanpool-redis -p 6379:6379 \
  redis:7 redis-server --appendonly yes --appendfsync everysec
# then: REDIS_URL=redis://localhost:6379
```

The board will then report `REDIS_AOF`. Without `--appendonly yes` it reports
`REDIS_CACHE_ONLY` and keeps the journal on disk — by design.

---

## 15. Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | none | Shallow liveness: state + dependency words only |
| GET | `/system/service-status` | signed-in | Honest user status. No internals |
| GET | `/admin/resilience/status` | admin | Full board; runs a live probe |
| GET | `/admin/resilience/journal` | admin | Journal contents |
| GET | `/admin/resilience/integrity` | admin | Run the 12 checks |
| POST | `/admin/resilience/replay` | admin | Replay pending intent (idempotent) |
| POST | `/admin/resilience/recover` | admin | Reconcile → validate → rebuild |
| POST | `/admin/resilience/rebuild-snapshots` | admin | Rebuild snapshots from Mongo |
| POST | `/admin/resilience/journal/:id/abandon` | admin | Abandon an entry — **reason required** |
| POST | `/admin/resilience/simulate` | admin | Start `OUTAGE` or `CORRUPTION` |
| POST | `/admin/resilience/simulate/stop` | admin | Clear the fault |
| POST | `/admin/resilience/redis/disable` | admin | Switch Redis **off** at runtime (failure-matrix CASE 3) |
| POST | `/admin/resilience/redis/enable` | admin | Connect/reconnect Redis. Optional `url` overrides `REDIS_URL` without a restart. Re-verifies durability |
| POST | `/admin/resilience/reset` | admin | Reset controller to baseline |

---

## 16. The live demo

Admin → **Resilience**.

1. **Normal** — board green. Replica set, member count and journal backend are shown.
2. **Simulate MongoDB failure** — within ~3 probes: `RECOVERY_REQUIRED`, database
   `DOWN`, writes restricted. In the mobile app a farmer sees *"System recovery in
   progress"* with the last-confirmed timestamp, **and their trip, requests,
   shipments, live track, machinery bookings and backhaul loads all still open** —
   served from the snapshots, each response stamped `X-Data-As-Of`. A booking
   attempt is **refused** with a reason.
2b. **Create a request while it is down.** It is refused — and the message says it
   was *saved*, with a reference. The board's **Pending events** counter moves. Do
   the same for a machinery booking. Try a payment: that one is refused flatly,
   with no promise, because money is never deferred.
3. **Clear simulation** → `RECONCILING`. **Run recovery** → replay → integrity →
   snapshot rebuild → `RECOVERED` (or `MANUAL_REVIEW`, honestly). **Replayed** on
   the board counts what was genuinely re-driven through the real business
   service. Reopen the farmer's request list: the request from step 2b is there
   for real. Run recovery again — nothing duplicates.
4. **Simulate data corruption** — note the *different* diagnosis: the database is
   reachable, but its data is unreadable, and the board says failover would not help.
5. **Turn Redis OFF** — the cache goes `DOWN`, the journal backend drops to `FILE`
   and stays **durable**, and the app carries on: writes are *not* restricted and a
   farmer can still create a request. That is failure-matrix CASE 3, shown rather
   than argued. **Turn Redis ON** to reconnect and re-verify durability.
6. **Run integrity checks** — every relationship classified, ambiguity surfaced
   rather than repaired.

The simulation is a variable in the server process. It modifies **no data**, and
clearing it — or restarting — restores normal behaviour immediately.
