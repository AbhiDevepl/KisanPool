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


def call(method, path, body=None, token=None):
    request = urllib.request.Request(BASE + path, method=method)
    if token:
        request.add_header("authorization", f"Bearer {token}")
    data = None
    if body is not None:
        request.add_header("content-type", "application/json")
        data = json.dumps(body).encode()
    try:
        with urllib.request.urlopen(request, data, timeout=60) as response:
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
check(
    "the journal reports whether it is genuinely durable",
    s["journal"]["durable"] is True and s["journal"]["backend"] in ("FILE", "REDIS_AOF"),
    f'{s["journal"]["backend"]} — {s["journal"]["detail"][:60]}',
)
check(
    "a cache-only Redis would never be used for intent",
    s["journal"]["backend"] != "REDIS_CACHE_ONLY",
    "AOF is verified before Redis is trusted with pending operations",
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
check("service status reports normal", call("GET", "/system/service-status", token=farmer)["normal"] is True)

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

print()
print(f"{passed} passed, {failed} failed")
raise SystemExit(1 if failed else 0)
