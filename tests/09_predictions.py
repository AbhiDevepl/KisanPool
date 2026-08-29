#!/usr/bin/env python3
"""
Predictive Insights — advisory risk scoring (ADR-041).

This suite proves the four things the feature has to be:

    1. DETERMINISTIC.  The same signals score the same level and the same reasons,
       every run.  `/predictions/simulate` feeds the pure engine crafted signals so
       the behaviour is pinned without staging real delayed trips.

    2. EXPLAINABLE.  Every level comes with at least one plain-language reason, and
       each reason is tied to a signal that actually fired.

    3. HONEST ABOUT THIN DATA.  A transporter with no history / a trip not yet
       started returns LOW at LOW confidence and says why — it never guesses, and
       it never errors.

    4. ADVISORY ONLY.  Reading a prediction changes nothing: the trip's pool size,
       total cost and state are identical before and after.  `/ops` and
       `/simulate` are admin-only; a farmer only ever sees delay, never the
       transporter's cancellation risk.

Run against a live server on a freshly seeded database:

    npm run seed -- --reset && python3 tests/09_predictions.py
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
        raise SystemExit(f"cannot sign in {phone}: {otp.get('__error')} {otp.get('__message', '')}")
    session = call("POST", "/auth/verify-otp", {"phone": phone, "code": otp["devCode"]})
    _sessions[phone] = (session["accessToken"], session["user"])
    return _sessions[phone]


def admin_login():
    result = call("POST", "/admin/login", {"username": "admin", "password": "admin"})
    if error_of(result):
        raise SystemExit(f"admin login failed: {error_of(result)}")
    return result["token"]


LASALGAON = {"name": "Lasalgaon Mandi", "lat": 20.1417, "lng": 74.2389}
PIMPRI = {"name": "Pimpri, Pune", "lat": 18.6298, "lng": 73.7997}
CHINCHWAD = {"name": "Chinchwad, Pune", "lat": 18.6414, "lng": 73.7629}

RISK_LEVELS = {"LOW", "MEDIUM", "HIGH"}
DEMAND_LEVELS = {"NORMAL", "MEDIUM", "HIGH"}


def simulate(token, kind, signals):
    return call("POST", "/predictions/simulate", {"kind": kind, "signals": signals}, token)


def post_request(token, crop, quantity, pickup):
    return call(
        "POST",
        "/transport/requests",
        {
            "cropType": crop,
            "quantityKg": quantity,
            "pickup": pickup,
            "destination": LASALGAON,
            "preferredDate": "2026-09-01T06:00:00.000Z",
        },
        token,
    )


def accept_and_confirm(driver, farmer, request):
    claim = call("POST", f'/pool/requests/{request["_id"]}/claim', {}, driver)
    if error_of(claim):
        return {"__error": error_of(claim), "__message": claim.get("__message", "")}
    offers = call("GET", f'/pool/requests/{request["_id"]}/offers', token=farmer)
    mine = next((o for o in offers if o["_id"] == claim["_id"]), None)
    if not mine:
        return {"__error": "NO_OFFER"}
    return call("POST", f'/pool/requests/{request["_id"]}/select', {"offerId": mine["_id"]}, farmer)


print("=== 1. the cast ===")
admin = admin_login()
driver, driver_user = login("9000000002", "TRANSPORTER")
a_token, a_user = login("9000000001", "FARMER")
b_token, b_user = login("9000000006", "FARMER")
check("admin, driver and two farmers signed in", bool(admin and driver and a_token and b_token))

print()
print("=== 2. the delay engine: normal vs behind-schedule ===")
NORMAL_DELAY = {
    "tripState": "EN_ROUTE",
    "routeKm": 120,
    "pickupCount": 2,
    "pickupsDone": 1,
    "delivered": 0,
    "minutesSinceStart": 45,
    "minutesSinceLastPing": 4,
    "leadShipmentStuckMinutes": 6,
}
BEHIND = {
    "tripState": "IN_TRANSIT",
    "routeKm": 360,
    "pickupCount": 4,
    "pickupsDone": 1,
    "delivered": 0,
    "minutesSinceStart": 420,
    "minutesSinceLastPing": 35,
    "leadShipmentStuckMinutes": 95,
}
normal = simulate(admin, "DELIVERY_DELAY", NORMAL_DELAY)
behind = simulate(admin, "DELIVERY_DELAY", BEHIND)

check("a healthy trip scores LOW", normal["level"] == "LOW", f'score {normal["score"]}')
check("every call carries at least one reason",
      len(normal["reasons"]) >= 1 and len(behind["reasons"]) >= 1)
check("a trip behind schedule with a long route and GPS silence scores HIGH",
      behind["level"] == "HIGH", f'score {behind["score"]}')
check("the HIGH call explains itself with several signals",
      len(behind["reasons"]) >= 3, f'{len(behind["reasons"])} reasons')
check("a behind-schedule reason is present",
      any("behind schedule" in r for r in behind["reasons"]),
      behind["reasons"][0])
check("the raw signals travel with the call",
      {"routeKm", "progressPct", "plannedMinutes"}.issubset(behind["signals"].keys()))

print()
print("=== 3. determinism: same signals, same call ===")
a1 = simulate(admin, "DELIVERY_DELAY", BEHIND)
a2 = simulate(admin, "DELIVERY_DELAY", BEHIND)
check("score is identical on a rerun", a1["score"] == a2["score"], f'{a1["score"]} == {a2["score"]}')
check("reasons are identical on a rerun", a1["reasons"] == a2["reasons"])
check("level is identical on a rerun", a1["level"] == a2["level"])

print()
print("=== 4. multiple pickups alone raise the risk ===")
one_pickup = simulate(admin, "DELIVERY_DELAY", {**NORMAL_DELAY, "pickupCount": 1})
four_pickups = simulate(admin, "DELIVERY_DELAY", {**NORMAL_DELAY, "pickupCount": 4, "pickupsDone": 0})
check("four pickups score higher than one", four_pickups["score"] > one_pickup["score"],
      f'{one_pickup["score"]} -> {four_pickups["score"]}')
check("the pickup count is named as a reason",
      any("pickup" in r.lower() for r in four_pickups["reasons"]), str(four_pickups["reasons"]))

print()
print("=== 5. cancellation risk: history and live signals ===")
CLEAN = {
    "tripState": "EN_ROUTE",
    "completedTrips": 12,
    "cancelledTrips": 0,
    "offersMade": 15,
    "offersWithdrawn": 1,
    "minutesSinceFirstConfirm": 20,
    "vehicleOffline": False,
    "minutesSinceLastPing": 3,
}
FLAKY = {
    "tripState": "FORMING",
    "completedTrips": 10,
    "cancelledTrips": 6,
    "offersMade": 20,
    "offersWithdrawn": 9,
    "minutesSinceFirstConfirm": 400,
    "vehicleOffline": True,
    "minutesSinceLastPing": None,
}
clean = simulate(admin, "CANCELLATION", CLEAN)
flaky = simulate(admin, "CANCELLATION", FLAKY)
check("a reliable transporter scores LOW", clean["level"] == "LOW", f'score {clean["score"]}')
check("a history of cancellations + offline vehicle scores HIGH",
      flaky["level"] == "HIGH", f'score {flaky["score"]}')
check("the cancellation-rate reason cites the real ratio",
      any("cancelled" in r for r in flaky["reasons"]), str(flaky["reasons"][:1]))

print()
print("=== 6. thin data is admitted, not guessed ===")
THIN = {
    "tripState": "FORMING",
    "completedTrips": 0,
    "cancelledTrips": 0,
    "offersMade": 0,
    "offersWithdrawn": 0,
    "minutesSinceFirstConfirm": 10,
    "vehicleOffline": False,
    "minutesSinceLastPing": None,
}
thin = simulate(admin, "CANCELLATION", THIN)
check("no history -> LOW at LOW confidence", thin["level"] == "LOW" and thin["confidence"] == "LOW",
      f'{thin["level"]} / {thin["confidence"]}')
check("it says the history is thin rather than inventing a number",
      any("history" in r.lower() for r in thin["reasons"]), str(thin["reasons"]))

not_started = simulate(admin, "DELIVERY_DELAY", {
    "tripState": "FORMING", "routeKm": 200, "pickupCount": 2, "pickupsDone": 0,
    "delivered": 0, "minutesSinceStart": 0, "minutesSinceLastPing": None,
    "leadShipmentStuckMinutes": 0,
})
check("a trip not yet started -> LOW delay at LOW confidence",
      not_started["level"] == "LOW" and not_started["confidence"] == "LOW",
      f'{not_started["level"]} / {not_started["confidence"]}')

print()
print("=== 7. demand: seeded open requests light up the corridor ===")
demand = call("GET", "/predictions/demand", token=driver)
check("demand returns a board", isinstance(demand, list) and len(demand) >= 1, f'{len(demand)} corridors')
lasalgaon = next((d for d in demand if d["mandi"] == "Lasalgaon Mandi"), None)
check("the seeded corridor is scored", lasalgaon is not None)
if lasalgaon:
    check("its level is valid and its reasons are non-empty",
          lasalgaon["level"] in DEMAND_LEVELS and len(lasalgaon["reasons"]) >= 1,
          f'{lasalgaon["level"]} :: {lasalgaon["reasons"][0]}')
    check("the open-request count is a signal on the call",
          "openRequests" in lasalgaon["signals"], str(lasalgaon["signals"]))
demand_again = call("GET", "/predictions/demand", token=driver)
check("the demand board is deterministic across calls",
      [d["mandi"] for d in demand] == [d["mandi"] for d in demand_again]
      and [d["score"] for d in demand] == [d["score"] for d in demand_again])

print()
print("=== 8. a real trip: driver sees cancellation, farmer does not ===")
req_a = post_request(a_token, "Onion", 1000, PIMPRI)
res_a = accept_and_confirm(driver, a_token, req_a)
check("A's booking is created", error_of(res_a) is None, str(error_of(res_a)))
TRIP_ID = res_a["trip"]["_id"]

driver_view = call("GET", f"/predictions/trips/{TRIP_ID}", token=driver)
farmer_view = call("GET", f"/predictions/trips/{TRIP_ID}", token=a_token)

check("the driver gets a delay call", driver_view.get("delay", {}).get("level") in RISK_LEVELS)
check("the driver ALSO gets a cancellation call",
      driver_view.get("cancellation", {}).get("level") in RISK_LEVELS)
check("the farmer gets a delay call", farmer_view.get("delay", {}).get("level") in RISK_LEVELS)
check("the farmer is NOT shown cancellation risk", "cancellation" not in farmer_view)
check("a fresh un-started trip is LOW delay risk",
      driver_view["delay"]["level"] == "LOW", f'score {driver_view["delay"]["score"]}')
check("the farmer and driver agree on the delay level",
      farmer_view["delay"]["level"] == driver_view["delay"]["level"])

print()
print("=== 9. access control ===")
outsider = call("GET", f"/predictions/trips/{TRIP_ID}", token=b_token)
check("a farmer not on the trip is refused", error_of(outsider) == "AUTH_FORBIDDEN",
      f'{error_of(outsider)}')
farmer_ops = call("GET", "/predictions/ops", token=a_token)
check("the ops roll-up refuses a marketplace token", error_of(farmer_ops) == "AUTH_FORBIDDEN",
      f'{error_of(farmer_ops)}')
farmer_sim = simulate(a_token, "DELIVERY_DELAY", NORMAL_DELAY)
check("simulate refuses a marketplace token", error_of(farmer_sim) == "AUTH_FORBIDDEN",
      f'{error_of(farmer_sim)}')
ops = call("GET", "/predictions/ops", token=admin)
check("admin gets the ops roll-up",
      isinstance(ops, dict) and "trips" in ops and "demand" in ops,
      f'{len(ops.get("trips", []))} trips, {len(ops.get("demand", []))} corridors')

print()
print("=== 10. a prediction is advisory — it changes nothing ===")
before = call("GET", f"/pool/trips/{TRIP_ID}", token=driver)
_ = call("GET", f"/predictions/trips/{TRIP_ID}", token=driver)
_ = call("GET", "/predictions/ops", token=admin)
after = call("GET", f"/pool/trips/{TRIP_ID}", token=driver)
check("the trip's pool size is unchanged",
      before["pricing"]["poolSize"] == after["pricing"]["poolSize"])
check("the trip's total cost is unchanged",
      abs(before["pricing"]["totalCost"] - after["pricing"]["totalCost"]) < 0.01)
check("the trip's state is unchanged", before["trip"]["state"] == after["trip"]["state"])

print()
print(f"{passed} passed, {failed} failed")
raise SystemExit(1 if failed else 0)
