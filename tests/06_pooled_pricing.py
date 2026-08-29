#!/usr/bin/env python3
"""
The pricing engine, end to end (ADR-034).

Suite 05 proves the *workflow* — accepting reserves nothing, confirming reserves
capacity, the race has exactly one winner. This suite proves the *money*, which is
the product itself:

    Vehicle 4t.  Farmer A 1t, Farmer B 1.5t, Farmer C 0.5t.

The assertions this suite exists for:

    1. ONE BACKEND NUMBER.  The farmer's "your share" and the transporter's
       "trip value" are slices of the same computation. Every farmer's share on a
       trip sums to exactly the trip total the driver is shown.

    2. NEVER AN EQUAL SPLIT.  Shares differ, and they differ because of load and
       distance — a farmer who sends more, or rides further, pays more.

    3. IT MOVES.  Each farmer who joins lowers what the others pay; a farmer who
       leaves raises it again; a delivered bill freezes and stops moving.

    4. IT NEVER OVERBOOKS.  Server-side, whatever the client asks for.

Run against a live server on a freshly seeded database:

    npm run seed -- --reset && python3 tests/06_pooled_pricing.py
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


LASALGAON = {"name": "Lasalgaon Mandi", "lat": 20.1417, "lng": 74.2389}
# deliberately spread out, so distance has something to say
PIMPRI = {"name": "Pimpri, Pune", "lat": 18.6298, "lng": 73.7997}          # ~225 km out
CHINCHWAD = {"name": "Chinchwad, Pune", "lat": 18.6414, "lng": 73.7629}    # beside Pimpri
NASHIK = {"name": "Nashik Road", "lat": 19.9975, "lng": 73.7898}           # ~65 km out

RUPEE = 0.02  # allowed rounding slack when summing money


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
    """The full two-sided handshake: the driver claims, the farmer picks them."""
    claim = call("POST", f'/pool/requests/{request["_id"]}/claim', {}, driver)
    if error_of(claim):
        return claim
    offers = call("GET", f'/pool/requests/{request["_id"]}/offers', token=farmer)
    mine = next((o for o in offers if o["_id"] == claim["_id"]), None)
    if not mine:
        return {"__error": "NO_OFFER"}
    result = call(
        "POST", f'/pool/requests/{request["_id"]}/select', {"offerId": mine["_id"]}, farmer
    )
    return {"quote": mine["quotedPrice"], "select": result}


def share_for(trip, farmer_id):
    return next((s for s in trip["pricing"]["shares"] if s["farmerId"] == farmer_id), None)


print("=== 1. the cast ===")
driver, driver_user = login("9000000002", "TRANSPORTER")
a_token, a_user = login("9000000001", "FARMER")
b_token, b_user = login("9000000006", "FARMER")
c_token, c_user = login("9000000007", "FARMER")

vehicle = call("GET", "/vehicles/me", token=driver)
CAPACITY = vehicle["capacityKg"]
RATE = vehicle["ratePerKm"]
check("4-tonne verified vehicle", CAPACITY == 4000 and vehicle["verificationStatus"] == "VERIFIED",
      f'{CAPACITY}kg @ ₹{RATE}/km')
check("the driver has a name on record", bool(driver_user["name"].strip()), driver_user["name"])

print()
print("=== 2. farmer A confirms alone (1t, ~225 km out) ===")
req_a = post_request(a_token, "Onion", 1000, PIMPRI)
res_a = accept_and_confirm(driver, a_token, req_a)
check("A's booking is created", error_of(res_a.get("select")) is None, str(error_of(res_a.get("select"))))

TRIP_ID = res_a["select"]["trip"]["_id"]
trip = call("GET", f"/pool/trips/{TRIP_ID}", token=driver)
p1 = trip["pricing"]
a1 = share_for(trip, a_user["_id"])

check("capacity reserves exactly A's load", trip["trip"]["capacity"]["committedKg"] == 1000,
      f'{trip["trip"]["capacity"]["committedKg"]}kg of {CAPACITY}kg')
check("trip cost is route × rate", abs(p1["totalCost"] - p1["effectiveRouteKm"] * RATE) < RUPEE,
      f'{p1["effectiveRouteKm"]}km × ₹{RATE} = ₹{p1["totalCost"]}')
check("the only farmer aboard carries the whole route", abs(a1["amount"] - p1["totalCost"]) < RUPEE,
      f'A pays ₹{a1["amount"]}')
check("the quote A accepted is the price A got", abs(res_a["quote"] - a1["amount"]) < RUPEE,
      f'quoted ₹{res_a["quote"]} → allocated ₹{a1["amount"]}')

a_alone = a1["amount"]

print()
print("=== 3. farmer B joins (1.5t, same corner of Pune) ===")
req_b = post_request(b_token, "Tomato", 1500, CHINCHWAD)
res_b = accept_and_confirm(driver, b_token, req_b)
check("B's booking is created", error_of(res_b.get("select")) is None, str(error_of(res_b.get("select"))))

trip = call("GET", f"/pool/trips/{TRIP_ID}", token=driver)
p2 = trip["pricing"]
a2, b2 = share_for(trip, a_user["_id"]), share_for(trip, b_user["_id"])

check("capacity counts both loads", trip["trip"]["capacity"]["committedKg"] == 2500,
      f'2500 committed, {trip["trip"]["capacity"]["availableKg"]} free')
check("A's share FELL when B joined", a2["amount"] < a_alone,
      f'₹{a_alone} → ₹{a2["amount"]}')
check("shares sum to the trip total", abs(a2["amount"] + b2["amount"] - p2["totalCost"]) < RUPEE,
      f'₹{a2["amount"]} + ₹{b2["amount"]} = ₹{p2["totalCost"]}')
check("it is NOT an equal split", abs(a2["amount"] - b2["amount"]) > RUPEE,
      f'A ₹{a2["amount"]} vs B ₹{b2["amount"]}')
check("the heavier load pays more of the shared run",
      b2["lineHaulCost"] > a2["lineHaulCost"],
      f'B 1500kg ₹{b2["lineHaulCost"]} > A 1000kg ₹{a2["lineHaulCost"]}')
check("B's quote is the price B got", abs(res_b["quote"] - b2["amount"]) < RUPEE,
      f'quoted ₹{res_b["quote"]} → allocated ₹{b2["amount"]}')

a_with_b = a2["amount"]

print()
print("=== 4. farmer C joins (0.5t, only ~65 km out) ===")
req_c = post_request(c_token, "Potato", 500, NASHIK)
res_c = accept_and_confirm(driver, c_token, req_c)
check("C's booking is created", error_of(res_c.get("select")) is None, str(error_of(res_c.get("select"))))

trip = call("GET", f"/pool/trips/{TRIP_ID}", token=driver)
p3 = trip["pricing"]
a3 = share_for(trip, a_user["_id"])
b3 = share_for(trip, b_user["_id"])
c3 = share_for(trip, c_user["_id"])

check("capacity counts all three", trip["trip"]["capacity"]["committedKg"] == 3000,
      f'3000 committed, {trip["trip"]["capacity"]["availableKg"]} free')
check("the vehicle is not overbooked",
      trip["trip"]["capacity"]["committedKg"] <= CAPACITY,
      f'{trip["trip"]["capacity"]["committedKg"]} <= {CAPACITY}')
check("all three shares sum to the trip total",
      abs(a3["amount"] + b3["amount"] + c3["amount"] - p3["totalCost"]) < RUPEE,
      f'₹{a3["amount"]} + ₹{b3["amount"]} + ₹{c3["amount"]} = ₹{p3["totalCost"]}')
check("no two farmers pay the same",
      len({round(a3["amount"], 2), round(b3["amount"], 2), round(c3["amount"], 2)}) == 3,
      f'{a3["amount"]} / {b3["amount"]} / {c3["amount"]}')
check("C rides far less of the route than A",
      c3["rideKm"] < a3["rideKm"] / 2,
      f'C {c3["rideKm"]}km vs A {a3["rideKm"]}km')
check("distance shows up in the shared run: C's tonne-km is the smallest",
      c3["tonneKm"] < a3["tonneKm"] and c3["tonneKm"] < b3["tonneKm"],
      f'A {a3["tonneKm"]} / B {b3["tonneKm"]} / C {c3["tonneKm"]} t·km')
check("everyone still beats going alone",
      all(s["amount"] < s["soloPrice"] for s in (a3, b3, c3)),
      " / ".join(f'{s["amount"]}<{s["soloPrice"]}' for s in (a3, b3, c3)))

print()
print("=== 5. the two sides agree ===")
for label, token, user in (("A", a_token, a_user), ("B", b_token, b_user), ("C", c_token, c_user)):
    farmer_view = call("GET", f"/pool/trips/{TRIP_ID}", token=token)
    mine = next(s for s in farmer_view["shipments"] if s["farmerId"] == user["_id"])
    driver_share = share_for(trip, user["_id"])
    check(f"farmer {label} sees the same share as the driver's ledger",
          abs(mine["pricing"]["amount"] - driver_share["amount"]) < RUPEE,
          f'farmer ₹{mine["pricing"]["amount"]} · driver ₹{driver_share["amount"]}')
    check(f"farmer {label} sees the same trip total",
          abs(farmer_view["pricing"]["totalCost"] - p3["totalCost"]) < RUPEE,
          f'₹{farmer_view["pricing"]["totalCost"]}')

mine_list = call("GET", "/pool/trips/mine", token=driver)
listed = next((t for t in mine_list if t["_id"] == TRIP_ID), None)
check("the trips list quotes the same total as the trip screen",
      listed is not None and abs(listed["pricing"]["totalCost"] - p3["totalCost"]) < RUPEE,
      f'₹{listed["pricing"]["totalCost"] if listed else "—"}')
check("the driver's earning is the total less the platform fee",
      abs(p3["transporterEarning"] + p3["platformFee"] - p3["totalCost"]) < RUPEE,
      f'₹{p3["transporterEarning"]} + ₹{p3["platformFee"]} = ₹{p3["totalCost"]}')
check("the driver earns more with three aboard than with one",
      p3["transporterEarning"] > p1["transporterEarning"],
      f'₹{p1["transporterEarning"]} → ₹{p3["transporterEarning"]}')

print()
print("=== 6. the vehicle refuses to overbook ===")
req_big = post_request(a_token, "Onion", 1500, PIMPRI)
claim_big = call("POST", f'/pool/requests/{req_big["_id"]}/claim', {}, driver)
check("a load beyond the remaining 1000kg is refused server-side",
      error_of(claim_big) == "CAPACITY_EXCEEDED",
      f'{error_of(claim_big)} — {claim_big.get("__message", "")}')

print()
print("=== 7. a farmer leaves before the trip locks ===")
call("POST", f'/transport/requests/{req_c["_id"]}/cancel', {"reason": "changed my mind"}, c_token)
trip = call("GET", f"/pool/trips/{TRIP_ID}", token=driver)
p4 = trip["pricing"]
a4 = share_for(trip, a_user["_id"])

check("the cancelled load releases its capacity",
      trip["trip"]["capacity"]["committedKg"] == 2500,
      f'{trip["trip"]["capacity"]["committedKg"]}kg')
check("C is off the trip's ledger", share_for(trip, c_user["_id"]) is None)
check("the remaining farmers were re-priced, not left stale",
      abs(a4["amount"] - a3["amount"]) > RUPEE,
      f'A ₹{a3["amount"]} → ₹{a4["amount"]}')
check("the remaining shares still sum to the trip total",
      abs(sum(s["amount"] for s in p4["shares"]) - p4["totalCost"]) < RUPEE,
      f'₹{p4["totalCost"]}')

print()
print("=== 8. a delivered bill freezes ===")
detail = call("GET", f"/pool/trips/{TRIP_ID}", token=driver)
ship_a = next(s for s in detail["shipments"] if s["farmerId"] == a_user["_id"])
farmer_a_view = call("GET", f"/pool/trips/{TRIP_ID}", token=a_token)
otp = next(s for s in farmer_a_view["shipments"] if s["farmerId"] == a_user["_id"])["pickupOtp"]

call("PATCH", f'/pool/trips/{TRIP_ID}/state', {"state": "EN_ROUTE"}, driver)
for state, body in (
    ("EN_ROUTE", {"state": "EN_ROUTE"}),
    ("ARRIVED", {"state": "ARRIVED"}),
    ("PICKED_UP", {"state": "PICKED_UP", "otp": otp}),
    ("IN_TRANSIT", {"state": "IN_TRANSIT"}),
    ("DELIVERED", {"state": "DELIVERED"}),
):
    step = call("PATCH", f'/pool/shipments/{ship_a["_id"]}/state', body, driver)
    if error_of(step):
        check(f"A's load reaches {state}", False, f'{error_of(step)} — {step.get("__message", "")}')
        break
else:
    trip = call("GET", f"/pool/trips/{TRIP_ID}", token=driver)
    frozen = share_for(trip, a_user["_id"])
    check("A's load was delivered and billed", frozen["frozen"] is True, f'₹{frozen["amount"]}')
    check("the frozen bill matches what A owed at delivery",
          abs(frozen["amount"] - a4["amount"]) < RUPEE,
          f'₹{a4["amount"]} → ₹{frozen["amount"]}')
    check("the trip total still equals the sum of every share",
          abs(sum(s["amount"] for s in trip["pricing"]["shares"]) - trip["pricing"]["totalCost"]) < RUPEE,
          f'₹{trip["pricing"]["totalCost"]}')

print()
print("=== 9. the audit trail explains every move ===")
history = call("GET", f"/pool/trips/{TRIP_ID}/pricing", token=driver)
check("every reallocation was recorded", len(history) >= 3, f'{len(history)} pricing events')
check("each event says why it happened",
      all(event.get("reason") for event in history),
      " · ".join(sorted({e["reason"] for e in history})))
check("each event carries the working, not just the answer",
      all("tonneKm" in a and "detourKm" in a for e in history for a in e["allocations"]),
      "rideKm / detourKm / tonneKm / detourCost / lineHaulCost")

print()
print(f"{passed} passed, {failed} failed")
raise SystemExit(1 if failed else 0)
