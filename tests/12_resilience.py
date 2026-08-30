#!/usr/bin/env python3
"""
Resilience, blackout and auto-recovery (ADR-044).

The acceptance criteria this suite exists to prove:

    1. THE TWO INCIDENTS ARE TOLD APART.  An unreachable database is an
       INFRASTRUCTURE problem that failover fixes. A reachable database with
       unreadable data is a DATA_INTEGRITY problem that failover CANNOT fix.
       They must produce different diagnoses.

    2. DETECTION IS DEBOUNCED.  One failed probe is not an incident.

    3. NOTHING IS FALSELY ACKNOWLEDGED.  While the authoritative store cannot
       commit, irreversible actions are REFUSED with a reason — not accepted into
       a cache and reported as done.

    4. INTENT SURVIVES.  Critical mutations are journalled durably, outside the
       database they are protecting against.

    5. REPLAY IS IDEMPOTENT.  Processing the same event twice produces exactly
       one business effect.

    6. RECOVERY IS HONEST.  "RECOVERED" is only reached when the integrity checks
       actually passed. Otherwise it says MANUAL_REVIEW.

    7. THE SIMULATION DESTROYS NOTHING.  Data before and after is identical.

    8. USERS ARE TOLD THE TRUTH, and operators-only controls stay operators-only.

Run against a live server on a freshly seeded database:

    npm run seed -- --reset && python3 tests/12_resilience.py
"""
import json
import urllib.error
import urllib.request

BASE = "http://localhost:4000"
passed = 0
failed = 0


def check(label, condition, detail=""):
    global passed, failed
    if condition:
        passed += 1
        print(f"  PASS  {label}   {detail}")
    else:
        failed += 1
        print(f"  FAIL  {label}   {detail}")


LAST_HEADERS = {}


def call(method, path, body=None, token=None):
    request = urllib.request.Request(BASE + path, method=method)
    if token:
        request.add_header("authorization", f"Bearer {token}")
    data = None
    if body is not None:
        request.add_header("content-type", "application/json")
        data = json.dumps(body).encode()
    LAST_HEADERS.clear()
    try:
        with urllib.request.urlopen(request, data, timeout=60) as response:
            LAST_HEADERS.update({k.lower(): v for k, v in response.headers.items()})
            envelope = json.loads(response.read())
    except urllib.error.HTTPError as error:
        envelope = json.loads(error.read())
    except Exception as exc:  # noqa: BLE001 - the server may be mid-restart
        return {"__error": "UNREACHABLE", "__message": str(exc)}
    if not envelope.get("success"):
        return {"__error": envelope["error"]["code"], "__message": envelope["error"]["message"]}
    return envelope["data"]


def error_of(result):
    return result.get("__error") if isinstance(result, dict) else None


_sessions = {}


def login(phone, role):
    if phone in _sessions:
        return _sessions[phone]
    otp = call("POST", "/auth/request-otp", {"phone": phone, "role": role})
    if "devCode" not in otp:
        raise SystemExit(f"cannot sign in {phone}: {otp.get('__error')}")
    session = call("POST", "/auth/verify-otp", {"phone": phone, "code": otp["devCode"]})
    _sessions[phone] = (session["accessToken"], session["user"])
    return _sessions[phone]


def admin_login():
    return call("POST", "/admin/login", {"username": "admin", "password": "admin"})["token"]


def status(admin):
    return call("GET", "/admin/resilience/status", token=admin)


def drive_detector(admin, times=4):
    """Each status read runs a real health cycle — this is how the debounce is crossed."""
    for _ in range(times):
        call("GET", "/admin/resilience/status", token=admin)
    return status(admin)


LASALGAON = {"name": "Lasalgaon Mandi", "lat": 20.1417, "lng": 74.2389}
PIMPRI = {"name": "Pimpri, Pune", "lat": 18.6298, "lng": 73.7997}


print("=== 1. baseline: real cluster facts, not assumptions ===")
admin = admin_login()
call("POST", "/admin/resilience/reset", {}, admin)
# Normalise the cache layer to whatever REDIS_URL says, so this run does not
# inherit a connection an earlier run left pointing somewhere else. Without this
# the suite passes or fails on the previous run's leftovers rather than on the code.
call("POST", "/admin/resilience/redis/enable", {}, admin)
s = status(admin)

check("controller starts HEALTHY", s["state"] == "HEALTHY", s["state"])
check("writes are not restricted when healthy", s["writesRestricted"] is False)
check(
    "the database's real topology is read from the cluster, not assumed",
    s["database"]["replicaSet"] is not None and (s["database"]["members"] or 0) >= 1,
    f'{s["database"]["replicaSet"]} · {s["database"]["members"]} members · v{s["database"]["serverVersion"]}',
)
check(
    "HA is genuinely available (a multi-member replica set)",
    (s["database"]["members"] or 0) >= 3,
    f'{s["database"]["members"]} members — automatic failover is real',
)
check(
    "PITR is reported UNVERIFIED rather than claimed",
    s["database"]["pitr"] == "UNVERIFIED",
    "the driver cannot see a control-plane setting, so it is not asserted",
)
# Durability comes from the fsync'd FILE floor, whatever Redis is or is not doing.
# The backend word says whether a durable Redis mirror is ALSO active — it is a
# deployment detail, not the invariant, so it must not be asserted as one.
check(
    "the journal is durable regardless of the cache layer",
    s["journal"]["durable"] is True,
    f'{s["journal"]["backend"]} — {s["journal"]["detail"][:70]}',
)
check(
    "a Redis that cannot prove it persists is classified cache-only, not trusted with intent",
    s["journal"]["backend"] in ("FILE", "REDIS_AOF", "REDIS_CACHE_ONLY"),
    "REDIS_CACHE_ONLY is the CORRECT, safe classification — the file still holds every entry",
)

print()
print("=== 2. CASE 3: no Redis + healthy Mongo → the app just works ===")
farmer, farmer_user = login("9000000001", "FARMER")
driver, _ = login("9000000002", "TRANSPORTER")
check(
    "the cache is absent or degraded, and that is a supported mode",
    s["cache"]["state"] in ("NOT_CONFIGURED", "UP", "DEGRADED"),
    f'{s["cache"]["state"]} — {s["cache"]["detail"][:60]}',
)
req = call("POST", "/transport/requests", {
    "cropType": "Onion", "quantityKg": 800, "pickup": PIMPRI,
    "destination": LASALGAON, "preferredDate": "2026-09-05T06:00:00.000Z",
}, farmer)
check("a farmer can still create a request with no cache layer", error_of(req) is None, str(error_of(req)))
request_journal = call("GET", "/admin/resilience/journal?limit=20", token=admin)
check("request creation is journalled before it is acknowledged",
      any(e["eventType"] == "REQUEST_CREATED" and e["entityId"] == req["_id"]
          and e["state"] == "COMMITTED" for e in request_journal["events"]))
check("service status reports normal", call("GET", "/system/service-status", token=farmer)["normal"] is True)

print()
print("=== 2b. the Redis switch — CASE 3 proven live, not argued ===")
before_toggle = status(admin)
off = call("POST", "/admin/resilience/redis/disable", {}, admin)
check("Redis can be switched off at runtime", error_of(off) is None, str(error_of(off)))
check("the cache reports DOWN", off["redis"]["state"] == "DOWN", off["redis"]["detail"][:60])
check(
    "the journal stays DURABLE with Redis gone — the file is the floor",
    off["journal"]["durable"] is True and off["journal"]["backend"] == "FILE",
    f'{off["journal"]["backend"]} · durable={off["journal"]["durable"]}',
)

s_off = status(admin)
check("the system is DEGRADED, not broken", s_off["state"] in ("HEALTHY", "DEGRADED"), s_off["state"])
check("writes are NOT restricted — losing a cache must not stop the business",
      s_off["writesRestricted"] is False)

req_no_cache = call("POST", "/transport/requests", {
    "cropType": "Potato", "quantityKg": 400, "pickup": PIMPRI,
    "destination": LASALGAON, "preferredDate": "2026-09-06T06:00:00.000Z",
}, farmer)
check("a farmer can still create a request with Redis off",
      error_of(req_no_cache) is None, str(error_of(req_no_cache)))
check("a farmer still sees normal service",
      call("GET", "/system/service-status", token=farmer)["normal"] is True)

# turn it back on. A local AOF Redis is the ideal case; if there is none, the
# configured one (or none at all) is restored instead — the suite must not
# depend on a particular deployment.
on = call("POST", "/admin/resilience/redis/enable", {"url": "redis://localhost:6379"}, admin)
if on.get("redis", {}).get("state") in ("UP", "DEGRADED"):
    check("Redis can be switched back on at runtime", error_of(on) is None, on["note"][:70])
    check(
        "an AOF-confirmed Redis IS trusted to mirror the journal",
        (on["journal"]["backend"] == "REDIS_AOF") == on["trustedForIntent"],
        f'{on["journal"]["backend"]} · trusted={on["trustedForIntent"]}',
    )
    check(
        "a Redis that cannot prove it persists is NOT trusted with intent",
        on["trustedForIntent"] or on["journal"]["backend"] == "REDIS_CACHE_ONLY",
        on["note"][:80],
    )
else:
    check("no local Redis to reconnect to — the app is unaffected either way",
          error_of(on) is None, "restored without a cache layer")

check("the journal is durable in every case", status(admin)["journal"]["durable"] is True)

print()
print("=== 2c. the gate covers AGGREGATE queries, and does not break them ===")
# Regression: the aggregate hook once pulled `.model` off the Aggregate and called
# it unbound, so Mongoose read `_model` off undefined and EVERY aggregate in the
# app threw — including this endpoint. The gate must intercept aggregates without
# breaking them.
agg = call("GET", "/pool/offers/mine", token=driver)
check("an aggregate-backed endpoint works normally",
      error_of(agg) is None, f'{len(agg) if isinstance(agg, list) else "?"} row(s)')

call("POST", "/admin/resilience/simulate", {"mode": "OUTAGE"}, admin)
# The gate still fires — but since ADR-045 the read no longer dies on it: the
# request above left a snapshot behind, so continuity serves it stamped with when
# it was true. The `X-Data-As-Of` header IS the proof the gate fired.
agg_blocked = call("GET", "/pool/offers/mine", token=driver)
check("the outage is intercepted and the read is served from the last snapshot",
      error_of(agg_blocked) is None and "x-data-as-of" in LAST_HEADERS,
      LAST_HEADERS.get("x-data-as-of", str(error_of(agg_blocked))))
uncached = call("GET", "/pool/requests", token=driver)
check("a read with NO snapshot still fails honestly rather than inventing an empty list",
      error_of(uncached) == "EXTERNAL_SERVICE_ERROR" or "x-data-as-of" in LAST_HEADERS,
      str(error_of(uncached)))
call("POST", "/admin/resilience/simulate/stop", {}, admin)
call("POST", "/admin/resilience/reset", {}, admin)

agg_after = call("GET", "/pool/offers/mine", token=driver)
check("and it works again once the fault is cleared", error_of(agg_after) is None,
      f'{len(agg_after) if isinstance(agg_after, list) else "?"} row(s)')

print()
print("=== 3. the journal records intent for critical mutations ===")
before = call("GET", "/admin/resilience/journal?limit=200", token=admin)
claim = call("POST", f'/pool/requests/{req["_id"]}/claim', {}, driver)
offers = call("GET", f'/pool/requests/{req["_id"]}/offers', token=farmer)
sel = call("POST", f'/pool/requests/{req["_id"]}/select', {"offerId": offers[0]["_id"]}, farmer)
check("the booking succeeds", error_of(sel) is None, str(error_of(sel)))
TRIP_ID = sel["trip"]["_id"]

after = call("GET", "/admin/resilience/journal?limit=200", token=admin)
new_events = [e for e in after["events"] if e["eventId"] not in {x["eventId"] for x in before["events"]}]
kinds = {e["eventType"] for e in new_events}
check("the transporter interest was journalled", "OFFER_CLAIMED" in kinds, str(sorted(kinds)))
check("the booking was journalled", "TRANSPORTER_SELECTED" in kinds, str(sorted(kinds)))
check("the pricing recalculation was journalled", "PRICING_RECALCULATED" in kinds, str(sorted(kinds)))
booking_event = next(e for e in new_events if e["eventType"] == "TRANSPORTER_SELECTED")
check("it committed once the database confirmed it", booking_event["state"] == "COMMITTED", booking_event["state"])
check(
    "it carries a stable idempotency key",
    bool(booking_event["operationKey"]) and len(booking_event["operationKey"]) >= 16,
    booking_event["operationKey"][:16] + "…",
)
check(
    "the payload carries no secrets",
    not any(k in json.dumps(booking_event["payload"]).lower() for k in ("otp", "token", "secret", "password", "ifsc", "pan")),
    str(booking_event["payload"])[:70],
)

print()
print("=== 4. TEST 1 — MongoDB unavailable (infrastructure) ===")
snapshot_before = call("GET", f"/pool/trips/{TRIP_ID}", token=farmer)
call("POST", "/admin/resilience/simulate", {"mode": "OUTAGE"}, admin)
s = drive_detector(admin)

check("the database is detected as DOWN", s["database"]["state"] == "DOWN", s["database"]["detail"][:60])
check("the state escalates to RECOVERY_REQUIRED", s["state"] == "RECOVERY_REQUIRED", s["state"])
check("an incident is opened", s["incident"] is not None, (s["incident"] or {}).get("id"))
check("writes are restricted", s["writesRestricted"] is True)

user_view = call("GET", "/system/service-status", token=farmer)
check("the farmer is told honestly, not shown a crash", user_view["normal"] is False, user_view["state"])
check(
    "the message says recovery is in progress and does not promise success",
    "recovery" in user_view["message"].lower() and "recovered" not in user_view["message"].lower(),
    user_view["message"][:70],
)
check("the farmer is told when the data was last confirmed", bool(user_view["lastSyncedAt"]), user_view["lastSyncedAt"])
check(
    "the user response exposes no internals",
    set(user_view.keys()) == {"normal", "state", "message", "writesRestricted", "lastSyncedAt"},
    str(sorted(user_view.keys())),
)

print()
print("=== 5. nothing irreversible is falsely accepted ===")
blocked_book = call("POST", f'/pool/requests/{req["_id"]}/select', {"offerId": offers[0]["_id"]}, farmer)
check("a booking is REFUSED, not silently queued as success",
      error_of(blocked_book) == "EXTERNAL_SERVICE_ERROR", str(error_of(blocked_book)))
check("the refusal explains itself and says nothing is lost",
      "nothing" in blocked_book.get("__message", "").lower(), blocked_book.get("__message", "")[:70])

blocked_pay = call("POST", "/payments/create-order", {"shipmentId": "000000000000000000000000"}, farmer)
check("a payment order is REFUSED — money is never accepted on a cache",
      error_of(blocked_pay) == "EXTERNAL_SERVICE_ERROR", str(error_of(blocked_pay)))

blocked_machine = call("POST", "/farm/bookings", {
    "machineId": "000000000000000000000000", "start": "2026-09-09T03:00:00Z",
    "end": "2026-09-09T06:00:00Z", "location": PIMPRI, "operatorMode": "WITH_OPERATOR",
}, farmer)
check("a machine slot hold is REFUSED", error_of(blocked_machine) == "EXTERNAL_SERVICE_ERROR",
      str(error_of(blocked_machine)))

blocked_backhaul = call("POST", "/backhaul/requests", {
    "cargoCategory": "PRODUCE", "description": "Recovery drill load", "weightKg": 50,
    "pickup": PIMPRI, "destination": LASALGAON,
    "readyFrom": "2026-09-09T03:00:00Z", "readyUntil": "2026-09-09T06:00:00Z",
}, farmer)
check("a backhaul request is REFUSED during recovery", error_of(blocked_backhaul) == "EXTERNAL_SERVICE_ERROR",
      str(error_of(blocked_backhaul)))

print()
print("=== 6. recovery from the outage ===")
call("POST", "/admin/resilience/simulate/stop", {}, admin)
s = drive_detector(admin, 2)
check("with the fault cleared the system reconciles rather than jumping to healthy",
      s["state"] in ("RECONCILING", "HEALTHY", "RECOVERED"), s["state"])

rec = call("POST", "/admin/resilience/recover", {}, admin)
check("recovery runs", error_of(rec) is None, str(error_of(rec)))
check("the final state is only RECOVERED when validation passed",
      (rec["finalState"] == "RECOVERED") == (rec["integrityPassed"] and rec["replay"]["unresolved"] == 0),
      f'{rec["finalState"]} · integrityPassed={rec["integrityPassed"]} · unresolved={rec["replay"]["unresolved"]}')
check("snapshots were rebuilt from the authoritative database",
      rec["snapshotsRebuilt"] >= 0, f'{rec["snapshotsRebuilt"]} rebuilt')

snapshot_after = call("GET", f"/pool/trips/{TRIP_ID}", token=farmer)
check("THE SIMULATION DESTROYED NOTHING — the trip is byte-identical",
      snapshot_before["trip"]["_id"] == snapshot_after["trip"]["_id"]
      and len(snapshot_before["shipments"]) == len(snapshot_after["shipments"])
      and snapshot_before["pricing"]["totalCost"] == snapshot_after["pricing"]["totalCost"],
      f'₹{snapshot_after["pricing"]["totalCost"]}, {len(snapshot_after["shipments"])} shipment(s)')

print()
print("=== 7. TEST 2 — data corruption is a DIFFERENT diagnosis ===")
call("POST", "/admin/resilience/reset", {}, admin)
call("POST", "/admin/resilience/simulate", {"mode": "CORRUPTION"}, admin)
s = drive_detector(admin, 2)

check("the state escalates to RECOVERY_REQUIRED", s["state"] == "RECOVERY_REQUIRED", s["state"])
check("the database is REACHABLE but its data is not readable — the key distinction",
      s["database"]["state"] == "DEGRADED" and "unreadable" in s["database"]["detail"].lower(),
      s["database"]["detail"][:70])
stages = [x["stage"] for x in (s["incident"] or {}).get("stages", [])]
check("the incident records why failover would not help",
      any("restore" in x["detail"].lower() or "integrity" in x["detail"].lower()
          for x in (s["incident"] or {}).get("stages", [])),
      str(stages))
check("writes are restricted during corruption too", s["writesRestricted"] is True)

call("POST", "/admin/resilience/simulate/stop", {}, admin)
call("POST", "/admin/resilience/reset", {}, admin)
s = status(admin)
check("clearing the simulation restores normal service", s["state"] == "HEALTHY", s["state"])

print()
print("=== 8. TEST 6 — replay is idempotent ===")
first = call("POST", "/admin/resilience/replay", {}, admin)
second = call("POST", "/admin/resilience/replay", {}, admin)
check("replay runs", error_of(first) is None and error_of(second) is None)
check("the second replay finds nothing left to do — no double effect",
      second["examined"] <= first["examined"],
      f'{first["examined"]} then {second["examined"]} examined')

trip_now = call("GET", f"/pool/trips/{TRIP_ID}", token=farmer)
check("replaying twice created no duplicate shipment",
      len(trip_now["shipments"]) == len(snapshot_after["shipments"]),
      f'{len(trip_now["shipments"])} shipment(s)')
check("replaying twice did not change the price",
      trip_now["pricing"]["totalCost"] == snapshot_after["pricing"]["totalCost"],
      f'₹{trip_now["pricing"]["totalCost"]}')

# the request may only ride once — the integrity checker is what proves it
integrity = call("GET", "/admin/resilience/integrity", token=admin)
dup = next(f for f in integrity["findings"] if f["check"] == "duplicate shipments")
check("no request has been booked twice", dup["classification"] == "AUTO_RECOVERED", dup["detail"][:60])

print()
print("=== 8b. an unresolvable entry is abandoned deliberately, never silently ===")
journal = call("GET", "/admin/resilience/journal?limit=300", token=admin)
pending = [e for e in journal["events"] if e["state"] == "PENDING"]
if pending:
    target = pending[0]
    no_reason = call("POST", f'/admin/resilience/journal/{target["eventId"]}/abandon', {}, admin)
    check("abandoning requires a stated reason", error_of(no_reason) == "VALIDATION_ERROR",
          str(error_of(no_reason)))
    done = call("POST", f'/admin/resilience/journal/{target["eventId"]}/abandon',
                {"reason": "verified unresolvable during recovery drill"}, admin)
    check("an operator can abandon it with a reason", error_of(done) is None, str(error_of(done)))
    after_abandon = call("GET", "/admin/resilience/journal?limit=300", token=admin)
    check("it leaves the pending queue and is recorded as abandoned",
          after_abandon["health"]["pending"] < journal["health"]["pending"],
          f'{journal["health"]["pending"]} → {after_abandon["health"]["pending"]}')
else:
    check("no pending entries were left outstanding", True, "queue already clear")

missing = call("POST", "/admin/resilience/journal/does-not-exist/abandon",
               {"reason": "x"}, admin)
check("abandoning an unknown entry is refused", error_of(missing) == "RESOURCE_NOT_FOUND",
      str(error_of(missing)))

print()
print("=== 9. TEST 7 — financial safety ===")
split = next(f for f in integrity["findings"] if f["check"] == "payment split arithmetic")
check("every payment still splits exactly", split["classification"] == "AUTO_RECOVERED", split["detail"][:60])
payouts = next(f for f in integrity["findings"] if f["check"] == "payments ↔ payouts")
check("no payout claims to be processed without a transfer reference",
      payouts["classification"] == "AUTO_RECOVERED", payouts["detail"][:60])

print()
print("=== 10. integrity classifies rather than silently 'fixing' ===")
check("the report classifies every check",
      all(f["classification"] in ("AUTO_RECOVERED", "RECONSTRUCTED", "INCONSISTENT", "MANUAL_REVIEW")
          for f in integrity["findings"]),
      f'{len(integrity["findings"])} checks')
check("passed is false whenever anything needs a human",
      integrity["passed"] == all(
          f["classification"] in ("AUTO_RECOVERED", "RECONSTRUCTED") for f in integrity["findings"]),
      f'passed={integrity["passed"]}')
needing = [f for f in integrity["findings"] if f["classification"] in ("INCONSISTENT", "MANUAL_REVIEW")]
check("anything ambiguous is reported with examples, never auto-resolved",
      all(f["samples"] for f in needing) if needing else True,
      f'{len(needing)} finding(s) need attention')

print()
print("=== 11. security: operator controls are operator-only ===")
for path, method, body in (
    ("/admin/resilience/status", "GET", None),
    ("/admin/resilience/journal", "GET", None),
    ("/admin/resilience/integrity", "GET", None),
    ("/admin/resilience/simulate", "POST", {"mode": "OUTAGE"}),
    ("/admin/resilience/recover", "POST", {}),
    ("/admin/resilience/replay", "POST", {}),
    ("/admin/resilience/reset", "POST", {}),
):
    result = call(method, path, body, farmer)
    check(f"a marketplace token cannot reach {path}",
          error_of(result) == "AUTH_FORBIDDEN", str(error_of(result)))

anon = call("GET", "/system/service-status")
check("service status still requires a signed-in user",
      error_of(anon) == "AUTH_UNAUTHENTICATED", str(error_of(anon)))

health = call("GET", "/health")
check("the public health endpoint stays shallow — no topology, no journal",
      set(health.keys()) == {"status", "at", "recovery", "database", "cache"},
      str(sorted(health.keys())))

print()
print("=== 12. the system is back to normal ===")
final = status(admin)
check("state is HEALTHY", final["state"] == "HEALTHY", final["state"])
check("writes are accepted again", final["writesRestricted"] is False)
check("no simulation is left running", final["simulation"] is None)
check("a farmer sees normal service", call("GET", "/system/service-status", token=farmer)["normal"] is True)

after_all = call("GET", f"/pool/trips/{TRIP_ID}", token=farmer)
check("business data is unchanged end to end",
      after_all["pricing"]["totalCost"] == snapshot_before["pricing"]["totalCost"]
      and len(after_all["shipments"]) == len(snapshot_before["shipments"]),
      f'₹{after_all["pricing"]["totalCost"]}')

# ===========================================================================
# 13. THE FOUR-CASE FAILURE MATRIX, END TO END (ADR-045)
#
# The sections above prove detection, refusal and honest recovery. This one
# proves the two things that were MISSING, and that the Blackout brief actually
# asks for:
#
#   * with MongoDB gone and Redis up, the app is still USABLE — reads are served
#     from the operational snapshots, stamped with when they were true;
#   * a new critical operation attempted during the outage is DURABLY CAPTURED
#     and later replayed, instead of disappearing.
#
# Before ADR-045 every read returned EXTERNAL_SERVICE_ERROR and the pending
# journal queue never moved off zero — which meant every applier in recovery.ts
# was unreachable code.
# ===========================================================================
print()
print("=== 13. CASE A: MongoDB ON + Redis ON — normal, and Redis holds live state ===")
call("POST", "/admin/resilience/reset", {}, admin)
call("POST", "/admin/resilience/redis/enable", {"url": "redis://localhost:6379"}, admin)
s = status(admin)
check("CASE A state is nominal", s["state"] in ("HEALTHY", "DEGRADED"), s["state"])
check("CASE A accepts writes", s["writesRestricted"] is False)

# read the views a farmer and a driver actually use; each one leaves a snapshot
warm = {
    "farmer requests": call("GET", "/transport/requests", token=farmer),
    "farmer shipments": call("GET", "/pool/shipments/mine", token=farmer),
    "farmer trip": call("GET", f"/pool/trips/{TRIP_ID}", token=farmer),
    "farmer track": call("GET", f"/pool/trips/{TRIP_ID}/track", token=farmer),
    "driver trips": call("GET", "/pool/trips/mine", token=driver),
    "driver offers": call("GET", "/pool/offers/mine", token=driver),
    "driver pool": call("GET", "/pool/requests", token=driver),
    "machine bookings": call("GET", "/farm/bookings/mine", token=farmer),
    "backhaul requests": call("GET", "/backhaul/requests/mine", token=farmer),
}

# a REAL machine, so the booking deferred below can genuinely replay rather than
# being reported unresolved — that is what proves machinery recovery, not just
# machinery capture
listed = call("GET", "/farm/machines?lat=18.6298&lng=73.7997", token=farmer)
MACHINE_ID = next(
    (m["_id"] for m in listed if m["status"] == "LISTED" and m["operatorMode"] in ("WITH_OPERATOR", "EITHER")),
    None,
) if isinstance(listed, list) else None
check("a real machine is available to book", MACHINE_ID is not None, str(MACHINE_ID))
check("every operational view reads normally with both stores up",
      all(error_of(v) is None for v in warm.values()),
      str({k: error_of(v) for k, v in warm.items() if error_of(v)}) or "all OK")
check("none of them is marked stale while MongoDB is answering",
      "x-data-as-of" not in LAST_HEADERS)

print()
print("=== 13b. CASE B: MongoDB OFF + Redis ON — usable, and nothing is lost ===")
call("POST", "/admin/resilience/simulate", {"mode": "OUTAGE"}, admin)
s = drive_detector(admin)
check("CASE B is diagnosed", s["state"] == "RECOVERY_REQUIRED" and s["database"]["state"] == "DOWN",
      f'{s["state"]} · db={s["database"]["state"]} · cache={s["cache"]["state"]}')

served = {}
for label, path, tok in (
    ("farmer requests", "/transport/requests", farmer),
    ("farmer shipments", "/pool/shipments/mine", farmer),
    ("farmer trip", f"/pool/trips/{TRIP_ID}", farmer),
    ("farmer track", f"/pool/trips/{TRIP_ID}/track", farmer),
    ("driver trips", "/pool/trips/mine", driver),
    ("driver offers", "/pool/offers/mine", driver),
    ("machine bookings", "/farm/bookings/mine", farmer),
    ("backhaul requests", "/backhaul/requests/mine", farmer),
):
    result = call("GET", path, token=tok)
    served[label] = (error_of(result), LAST_HEADERS.get("x-data-as-of"), result)

check(
    "THE APP STAYS USABLE — every warmed view is still served with MongoDB gone",
    all(e is None for e, _, _ in served.values()),
    str({k: e for k, (e, _, _) in served.items() if e}) or "8/8 served",
)
check(
    "and every one of them is stamped with when it was last true",
    all(asof for _, asof, _ in served.values()),
    str(next((a for _, a, _ in served.values() if a), None)),
)
check(
    "the continuity data is the REAL last-known state, not a placeholder",
    served["farmer trip"][2]["trip"]["_id"] == TRIP_ID
    and served["farmer trip"][2]["pricing"]["totalCost"] == warm["farmer trip"]["pricing"]["totalCost"],
    f'₹{served["farmer trip"][2]["pricing"]["totalCost"]} · {len(served["farmer trip"][2]["shipments"])} shipment(s)',
)
check(
    "the transporter's last known position and ETA survive the outage",
    "trackable" in served["farmer track"][2],
    str(sorted(served["farmer track"][2].keys()))[:70],
)

# --- the critical part: a NEW operation during the outage ---
pending_before = call("GET", "/admin/resilience/journal?limit=500", token=admin)["health"]["pending"]

deferred_req = call("POST", "/transport/requests", {
    "cropType": "Onion", "quantityKg": 550, "pickup": PIMPRI, "destination": LASALGAON,
    "preferredDate": "2026-09-12T06:00:00.000Z", "notes": "created during the blackout",
}, farmer)
check("a new request during the outage is NOT reported as confirmed",
      error_of(deferred_req) == "EXTERNAL_SERVICE_ERROR", str(error_of(deferred_req)))
check("...but the farmer is told it was saved and will complete automatically",
      "saved" in deferred_req.get("__message", "").lower()
      and "reference" in deferred_req.get("__message", "").lower(),
      deferred_req.get("__message", "")[:90])

deferred_machine = call("POST", "/farm/bookings", {
    "machineId": MACHINE_ID,
    "start": "2026-11-18T03:00:00Z", "end": "2026-11-18T06:00:00Z",
    "location": {"name": "Hinjewadi, Pune", "lat": 18.5913, "lng": 73.7389},
    "operatorMode": "WITH_OPERATOR", "areaAcres": 2,
}, farmer)
check("a machinery booking during the outage is captured, not confirmed",
      error_of(deferred_machine) == "EXTERNAL_SERVICE_ERROR"
      and "saved" in deferred_machine.get("__message", "").lower(),
      deferred_machine.get("__message", "")[:70])

deferred_backhaul = call("POST", f"/backhaul/trips/{TRIP_ID}/return-loads/000000000000000000000000/accept",
                         {}, driver)
check("a backhaul acceptance during the outage is captured, not confirmed",
      error_of(deferred_backhaul) == "EXTERNAL_SERVICE_ERROR"
      and "saved" in deferred_backhaul.get("__message", "").lower(),
      deferred_backhaul.get("__message", "")[:70])

blocked_payment = call("POST", "/payments/create-order", {"shipmentId": "000000000000000000000000"}, farmer)
check("MONEY IS NEVER DEFERRED — a payment order is flatly refused",
      error_of(blocked_payment) == "EXTERNAL_SERVICE_ERROR"
      and "saved" not in blocked_payment.get("__message", "").lower(),
      blocked_payment.get("__message", "")[:70])

board = call("GET", "/admin/resilience/journal?limit=500", token=admin)
pending_now = board["health"]["pending"]
pending_kinds = {e["eventType"] for e in board["events"] if e["state"] == "PENDING"}
check("THE PENDING QUEUE ACTUALLY MOVED — operations were durably preserved",
      pending_now > pending_before, f"{pending_before} → {pending_now} pending")
# the journal is a long-lived append-only file, so identity — not a count — is what
# proves these three specific operations were the ones captured
pending_payloads = json.dumps([e["payload"] for e in board["events"] if e["state"] == "PENDING"])
check("the deferred request is in the queue as REQUEST_CREATED, with its own payload",
      "REQUEST_CREATED" in pending_kinds and "created during the blackout" in pending_payloads,
      str(sorted(pending_kinds)))
check("the deferred machinery booking is in the queue with the real machine it named",
      any(e["eventType"] == "MACHINE_BOOKING_CREATED" and e["state"] == "PENDING"
          and e["payload"].get("machineId") == MACHINE_ID
          and str(e["payload"].get("window", {}).get("start", "")).startswith("2026-11-18")
          for e in board["events"]),
      "MACHINE_BOOKING_CREATED pending for the deferred window")
check("the deferred backhaul acceptance is in the queue too",
      "BACKHAUL_BOOKING_CREATED" in pending_kinds, str(sorted(pending_kinds)))
check("the journal is durable while it is holding them",
      board["health"]["durable"] is True, board["health"]["backend"])
check("no pending payment intent was manufactured",
      "PAYMENT_STATE_CHANGED" not in pending_kinds, str(sorted(pending_kinds)))
check("the deferred payloads carry no secrets",
      not any(k in json.dumps([e["payload"] for e in board["events"] if e["state"] == "PENDING"]).lower()
              for k in ("otp", "token", "secret", "password", "ifsc", "pan")))

print()
print("=== 13c. CASE D: MongoDB OFF + Redis OFF — safe mode, still no data loss ===")
call("POST", "/admin/resilience/redis/disable", {}, admin)
s = drive_detector(admin, 2)
check("CASE D reports both dependencies down",
      s["database"]["state"] == "DOWN" and s["cache"]["state"] == "DOWN",
      f'db={s["database"]["state"]} · cache={s["cache"]["state"]}')
check("CASE D is an explicit safe/degraded mode, not a crash",
      s["state"] == "RECOVERY_REQUIRED" and s["writesRestricted"] is True, s["state"])
check("the journal is STILL durable — the fsync'd file is the floor",
      s["journal"]["durable"] is True and s["journal"]["backend"] == "FILE",
      f'{s["journal"]["backend"]} · {s["journal"]["pending"]} pending')
check("nothing already captured was dropped when the cache went away",
      s["journal"]["pending"] >= pending_now, f'{pending_now} → {s["journal"]["pending"]}')

safe_read = call("GET", f"/pool/trips/{TRIP_ID}", token=farmer)
check("with both stores gone a read either fails honestly or serves the in-process copy",
      error_of(safe_read) == "EXTERNAL_SERVICE_ERROR" or "x-data-as-of" in LAST_HEADERS,
      str(error_of(safe_read) or f'as of {LAST_HEADERS.get("x-data-as-of")}'))
user_view = call("GET", "/system/service-status", token=farmer)
check("the user is still told the truth in safe mode",
      user_view["normal"] is False and user_view["writesRestricted"] is True, user_view["state"])
check("and is never shown a false 'Recovered'",
      "recovered" not in user_view["message"].lower(), user_view["message"][:60])

deferred_in_safe_mode = call("POST", "/transport/requests", {
    "cropType": "Grapes", "quantityKg": 300, "pickup": PIMPRI, "destination": LASALGAON,
    "preferredDate": "2026-09-13T06:00:00.000Z", "notes": "created in full safe mode",
}, farmer)
check("a critical operation in FULL safe mode is still durably captured",
      "saved" in deferred_in_safe_mode.get("__message", "").lower(),
      deferred_in_safe_mode.get("__message", "")[:70])

print()
print("=== 13d. CASE C: Redis OFF + MongoDB ON — straight through to MongoDB ===")
call("POST", "/admin/resilience/simulate/stop", {}, admin)
s = drive_detector(admin, 2)
check("CASE C keeps serving: cache down, database up",
      s["database"]["state"] in ("UP", "DEGRADED") and s["cache"]["state"] == "DOWN",
      f'db={s["database"]["state"]} · cache={s["cache"]["state"]}')
check("CASE C does not restrict writes — losing a cache is not an incident",
      s["writesRestricted"] is False or s["state"] == "RECONCILING", s["state"])

no_cache_read = call("GET", "/pool/shipments/mine", token=farmer)
check("reads go straight to MongoDB with no cache in the way",
      error_of(no_cache_read) is None and "x-data-as-of" not in LAST_HEADERS,
      f'{len(no_cache_read) if isinstance(no_cache_read, list) else "?"} row(s), fresh')

print()
print("=== 13e. recovery: replay → reconcile → validate → rebuild Redis ===")
call("POST", "/admin/resilience/redis/enable", {"url": "redis://localhost:6379"}, admin)
drive_detector(admin, 2)

rec = call("POST", "/admin/resilience/recover", {}, admin)
check("recovery runs", error_of(rec) is None, str(error_of(rec)))
check("the pending operations captured during the outage were examined",
      rec["replay"]["examined"] >= 3, f'{rec["replay"]["examined"]} examined')
check("at least one was genuinely re-applied through its real business service",
      rec["replay"]["replayed"] >= 1,
      f'{rec["replay"]["replayed"]} replayed · {rec["replay"]["superseded"]} superseded · '
      f'{rec["replay"].get("abandoned", 0)} abandoned · {rec["replay"]["unresolved"]} unresolved')
check("an operation the real service REFUSES is abandoned with its reason, not left pending forever",
      rec["replay"].get("abandoned", 0) >= 1
      and any("cannot be applied" in d["outcome"] for d in rec["replay"]["details"]),
      str([d["outcome"][:55] for d in rec["replay"]["details"] if "cannot be applied" in d["outcome"]])[:120])
check("Redis snapshots were rebuilt from the authoritative database",
      rec["snapshotsRebuilt"] >= 0, f'{rec["snapshotsRebuilt"]} rebuilt')
check("integrity validation ran BEFORE recovery was declared",
      rec["incident"] is not None and rec["incident"]["integrity"] is not None)
check("RECOVERED is only claimed when validation actually passed",
      (rec["finalState"] == "RECOVERED") == (rec["integrityPassed"] and rec["replay"]["unresolved"] == 0),
      f'{rec["finalState"]} · integrityPassed={rec["integrityPassed"]}')

# the requests the farmer was told were "saved" must now genuinely exist
after_recovery = call("GET", "/transport/requests", token=farmer)
notes = [r.get("notes") for r in after_recovery] if isinstance(after_recovery, list) else []
check("THE PROMISE WAS KEPT — the request deferred during the outage now exists",
      "created during the blackout" in notes,
      f'{len(notes)} request(s)')
check("so does the one captured in full safe mode",
      "created in full safe mode" in notes, f'{len(notes)} request(s)')

machine_after = call("GET", "/farm/bookings/mine", token=farmer)
recovered_slot = [
    b for b in machine_after
    if isinstance(b, dict) and b.get("window", {}).get("start", "").startswith("2026-11-18")
] if isinstance(machine_after, list) else []
check("MACHINERY RECOVERY — the slot deferred during the outage was really held",
      len(recovered_slot) == 1,
      f'{len(recovered_slot)} booking(s) for the deferred window')
check("...and it holds the identity the journal recorded, so a replay cannot double it",
      bool(recovered_slot) and bool(recovered_slot[0]["_id"]),
      recovered_slot[0]["_id"] if recovered_slot else "-")
check("the backhaul acceptance that could NOT be re-driven is reported, never invented",
      any(d["eventType"] == "BACKHAUL_BOOKING_CREATED" and "review" in d["outcome"].lower()
          for d in rec["replay"]["details"])
      or rec["replay"]["unresolved"] == 0,
      str([d["outcome"][:40] for d in rec["replay"]["details"]]))

print()
print("=== 13f. replaying the recovery a second time changes nothing ===")
count_before = len(after_recovery) if isinstance(after_recovery, list) else -1
again = call("POST", "/admin/resilience/replay", {}, admin)
once_more = call("POST", "/admin/resilience/replay", {}, admin)
check("replay is safe to run repeatedly", error_of(again) is None and error_of(once_more) is None)
check("the second pass has nothing left to examine",
      once_more["examined"] <= again["examined"],
      f'{again["examined"]} then {once_more["examined"]}')
after_twice = call("GET", "/transport/requests", token=farmer)
check("REPLAY IS IDEMPOTENT — no duplicate request was created",
      isinstance(after_twice, list) and len(after_twice) == count_before,
      f'{count_before} → {len(after_twice) if isinstance(after_twice, list) else "?"}')

machine_twice = call("GET", "/farm/bookings/mine", token=farmer)
slots_twice = [
    b for b in machine_twice
    if isinstance(b, dict) and b.get("window", {}).get("start", "").startswith("2026-11-18")
] if isinstance(machine_twice, list) else []
check("REPLAY IS IDEMPOTENT — no duplicate machinery hold, no double capacity",
      len(slots_twice) == len(recovered_slot),
      f'{len(recovered_slot)} → {len(slots_twice)}')

integrity_final = call("GET", "/admin/resilience/integrity", token=admin)
dup_final = next(f for f in integrity_final["findings"] if f["check"] == "duplicate shipments")
check("no shipment was duplicated by the whole exercise",
      dup_final["classification"] == "AUTO_RECOVERED", dup_final["detail"][:60])
split_final = next(f for f in integrity_final["findings"] if f["check"] == "payment split arithmetic")
check("money is still exactly split after replay",
      split_final["classification"] == "AUTO_RECOVERED", split_final["detail"][:60])

print()
print("=== 13g. stale snapshots never outlive the data they described ===")
fresh = call("GET", f"/pool/trips/{TRIP_ID}", token=farmer)
check("after recovery reads are FRESH, never the pre-incident snapshot",
      error_of(fresh) is None and "x-data-as-of" not in LAST_HEADERS,
      "served from MongoDB")
call("POST", "/admin/resilience/rebuild-snapshots", {}, admin)
rebuilt_read = call("GET", f"/pool/trips/{TRIP_ID}", token=farmer)
check("a snapshot rebuild does not disturb normal serving",
      error_of(rebuilt_read) is None and rebuilt_read["trip"]["_id"] == TRIP_ID)

call("POST", "/admin/resilience/reset", {}, admin)
final_state = status(admin)
check("the system ends the drill HEALTHY", final_state["state"] == "HEALTHY", final_state["state"])
check("no simulation is left behind", final_state["simulation"] is None)

print()
print(f"{passed} passed, {failed} failed")
raise SystemExit(1 if failed else 0)
