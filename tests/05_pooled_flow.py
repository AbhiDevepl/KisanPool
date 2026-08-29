#!/usr/bin/env python3
"""
End-to-end validation of the pooled-transport workflow.

Replaces the assertions in 01/02 that still target the pre-pooling API
(`/transport/requests/{id}/matches`, `/accept`, `/status`, `/trips/available`),
none of which exist any more. Written against the routes the app actually calls.

The assertion this suite exists for:

    A TRANSPORTER'S ACCEPTANCE RESERVES NOTHING.
    ONLY A FARMER'S CONFIRMATION RESERVES CAPACITY.

Everything else — pooling, pricing, pickup, delivery, settlement, the admin
board — is checked around that invariant, plus the capacity race two farmers can
run for the last space on one vehicle.
"""
import json
import sys
import threading
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


def call(method, path, body=None, token=None, raw=False):
    request = urllib.request.Request(BASE + path, method=method)
    if token:
        request.add_header("authorization", f"Bearer {token}")
    data = None
    if body is not None:
        request.add_header("content-type", "application/json")
        data = json.dumps(body).encode()
    try:
        with urllib.request.urlopen(request, data, timeout=30) as response:
            envelope = json.loads(response.read())
    except urllib.error.HTTPError as error:
        envelope = json.loads(error.read())
    if raw:
        return envelope
    if not envelope.get("success"):
        return {"__error": envelope["error"]["code"], "__message": envelope["error"]["message"]}
    return envelope["data"]


def error_of(result):
    return result.get("__error") if isinstance(result, dict) else None


_sessions = {}


def login(phone, role):
    """One OTP per phone per run — requesting more trips the real rate limiter."""
    if phone in _sessions:
        return _sessions[phone]
    otp = call("POST", "/auth/request-otp", {"phone": phone, "role": role})
    if "devCode" not in otp:
        raise SystemExit(f"cannot sign in {phone}: {otp.get('__error')} {otp.get('__message', '')}")
    session = call("POST", "/auth/verify-otp", {"phone": phone, "code": otp["devCode"]})
    if "accessToken" not in session:
        raise SystemExit(f"cannot verify {phone}: {session.get('__error')}")
    _sessions[phone] = (session["accessToken"], session["user"])
    return _sessions[phone]


LASALGAON = {"name": "Lasalgaon Mandi", "lat": 20.1417, "lng": 74.2389}
PIMPRI = {"name": "Pimpri, Pune", "lat": 18.6298, "lng": 73.7997}
CHINCHWAD = {"name": "Chinchwad, Pune", "lat": 18.6414, "lng": 73.7629}


def new_request(token, crop, kg, pickup):
    return call(
        "POST",
        "/transport/requests",
        {
            "cropType": crop,
            "quantityKg": kg,
            "pickup": pickup,
            "destination": LASALGAON,
            "preferredDate": "2026-09-01T06:00:00.000Z",
        },
        token,
    )


print("=== 1. sign in ===")
farmer_a, user_a = login("9000000001", "FARMER")
farmer_b, user_b = login("9000000006", "FARMER")
driver, user_driver = login("9000000002", "TRANSPORTER")
check("farmer A signs in", bool(farmer_a), user_a["name"])
check("farmer B signs in", bool(farmer_b), user_b["name"])
check("transporter signs in", bool(driver), user_driver["name"])

vehicle = call("GET", "/vehicles/me", token=driver)
check("transporter has a verified vehicle", vehicle["verificationStatus"] == "VERIFIED",
      f'{vehicle["registrationNumber"]} · {vehicle["capacityKg"]}kg')
CAPACITY = vehicle["capacityKg"]

print()
print("=== 2. farmers post loads ===")
req_a = new_request(farmer_a, "Onion", 1000, PIMPRI)
req_b = new_request(farmer_b, "Tomato", 1500, CHINCHWAD)
check("farmer A's request is OPEN", req_a["state"] == "OPEN", req_a["state"])
check("farmer B's request is OPEN", req_b["state"] == "OPEN", req_b["state"])

print()
print("=== 3. transporter goes online and sees them ===")
call("PATCH", f'/vehicles/{vehicle["_id"]}/availability', {"status": "AVAILABLE"}, driver)
pool = call("GET", "/pool/requests", token=driver)
check("pool is open to an online driver", pool["offline"] is False)
ids = [entry["request"]["_id"] for entry in pool["requests"]]
check("farmer A's load is in the pool", req_a["_id"] in ids, f'{len(ids)} loads visible')
check("farmer B's load is in the pool", req_b["_id"] in ids)

print()
print("=== 4. the transporter accepts BOTH (multi-accept) ===")
offer_a = call("POST", f'/pool/requests/{req_a["_id"]}/claim', {"message": "Passing at 7am"}, driver)
offer_b = call("POST", f'/pool/requests/{req_b["_id"]}/claim', {}, driver)
check("accepted farmer A", offer_a.get("state") == "INTERESTED", offer_a.get("state"))
check("accepted farmer B", offer_b.get("state") == "INTERESTED", offer_b.get("state"))
check("a driver may hold several acceptances at once",
      len(call("GET", "/pool/offers/mine", token=driver)) >= 2)

print()
print("=== 5. THE INVARIANT: acceptance reserves nothing ===")
after_accept = call("GET", "/pool/requests", token=driver)
committed = after_accept["trip"]["capacity"]["committedKg"] if after_accept["trip"] else 0
available = after_accept["trip"]["capacity"]["availableKg"] if after_accept["trip"] else CAPACITY
check("no capacity is committed by acceptances alone", committed == 0, f"committedKg={committed}")
check("the whole vehicle is still available", available == CAPACITY, f"availableKg={available}")

state_a = call("GET", f'/transport/requests/{req_a["_id"]}', token=farmer_a)
check("farmer A's request is TRANSPORTER_INTERESTED, not CONFIRMED",
      state_a["request"]["state"] == "TRANSPORTER_INTERESTED", state_a["request"]["state"])
check("no shipment exists before the farmer confirms", state_a["shipment"] is None)

print()
print("=== 6. the farmer compares and confirms ===")
offers = call("GET", f'/pool/requests/{req_a["_id"]}/offers', token=farmer_a)
check("farmer A sees who accepted", len(offers) >= 1, f"{len(offers)} option(s)")
check("each option quotes a price and a saving",
      all("quotedPrice" in o and "soloPrice" in o for o in offers))

confirmed_a = call("POST", f'/pool/requests/{req_a["_id"]}/select', {"offerId": offer_a["_id"]}, farmer_a)
check("confirming creates a trip", "trip" in confirmed_a, confirmed_a.get("trip", {}).get("_id"))
check("confirming creates a shipment", "shipment" in confirmed_a)
check("NOW capacity is reserved",
      confirmed_a["capacity"]["committedKg"] == 1000, confirmed_a["capacity"]["committedKg"])
trip_id = confirmed_a["trip"]["_id"]
shipment_a = confirmed_a["shipment"]

print()
print("=== 7. a second farmer pools onto the same vehicle ===")
confirmed_b = call("POST", f'/pool/requests/{req_b["_id"]}/select', {"offerId": offer_b["_id"]}, farmer_b)
check("farmer B joins the same trip", confirmed_b["trip"]["_id"] == trip_id, trip_id)
check("capacity now counts both", confirmed_b["capacity"]["committedKg"] == 2500,
      confirmed_b["capacity"]["committedKg"])
check("remaining space is correct",
      confirmed_b["capacity"]["availableKg"] == CAPACITY - 2500,
      confirmed_b["capacity"]["availableKg"])

trip = call("GET", f"/pool/trips/{trip_id}", token=driver)
check("both farmers are aboard one vehicle", len(trip["shipments"]) == 2)
check("pooling re-split the cost",
      all(s["allocatedPrice"] < s["soloPrice"] for s in trip["shipments"]),
      " / ".join(f'{s["allocatedPrice"]}<{s["soloPrice"]}' for s in trip["shipments"]))

print()
print("=== 8. edge cases ===")
farmer_c, _ = login("9000000007", "FARMER")
too_big = new_request(farmer_c, "Potato", CAPACITY, PIMPRI)
oversize = call("POST", f'/pool/requests/{too_big["_id"]}/claim', {}, driver)
check("a load beyond remaining capacity is refused",
      error_of(oversize) == "CAPACITY_EXCEEDED", error_of(oversize) or "accepted!")

duplicate = call("POST", f'/pool/requests/{req_a["_id"]}/select', {"offerId": offer_a["_id"]}, farmer_a)
check("a second confirmation of the same request is refused",
      error_of(duplicate) is not None, error_of(duplicate) or "allowed twice!")

foreign = call("GET", f'/pool/requests/{req_b["_id"]}/offers', token=farmer_a)
check("a farmer cannot read another farmer's offers",
      error_of(foreign) in ("AUTH_FORBIDDEN", "RESOURCE_NOT_FOUND"), error_of(foreign))

missing = call("GET", "/pool/trips/000000000000000000000000", token=farmer_a)
check("an unknown trip is RESOURCE_NOT_FOUND", error_of(missing) == "RESOURCE_NOT_FOUND",
      error_of(missing))

anon = call("GET", "/pool/offers/mine")
check("an unauthenticated call is refused", error_of(anon) == "AUTH_UNAUTHENTICATED", error_of(anon))

print()
print("=== 9. CONCURRENCY: two farmers race for the last space ===")
# fill the vehicle to within one load of full, then have two farmers of equal
# size confirm at the same instant. Exactly one may win.
remaining = CAPACITY - 2500
racer_tokens = []
for token in (farmer_a, farmer_b):
    request = new_request(token, "Onion", remaining, PIMPRI)
    offer = call("POST", f'/pool/requests/{request["_id"]}/claim', {}, driver)
    if error_of(offer):
        check("race setup: driver could accept both racers", False, error_of(offer))
    racer_tokens.append((token, request["_id"], offer.get("_id")))

results = {}


def race(index, token, request_id, offer_id):
    results[index] = call("POST", f"/pool/requests/{request_id}/select", {"offerId": offer_id}, token)


threads = [
    threading.Thread(target=race, args=(i, t, r, o))
    for i, (t, r, o) in enumerate(racer_tokens)
]
for thread in threads:
    thread.start()
for thread in threads:
    thread.join()

winners = [r for r in results.values() if error_of(r) is None]
losers = [r for r in results.values() if error_of(r) is not None]
check("exactly one farmer wins the last space", len(winners) == 1,
      f"{len(winners)} won, {len(losers)} refused")
check("the loser gets a clear capacity error",
      all(error_of(r) in ("CONCURRENT_BOOKING", "CAPACITY_EXCEEDED") for r in losers),
      ", ".join(error_of(r) for r in losers) or "none")

final = call("GET", f"/pool/trips/{trip_id}", token=driver)
check("the vehicle is never overbooked",
      final["trip"]["capacity"]["committedKg"] <= CAPACITY,
      f'{final["trip"]["capacity"]["committedKg"]} <= {CAPACITY}')

print()
print("=== 10. pickup, delivery, settlement ===")
call("PATCH", f"/pool/trips/{trip_id}/state", {"state": "EN_ROUTE"}, driver)
call("PATCH", f'/pool/shipments/{shipment_a["_id"]}/state', {"state": "EN_ROUTE"}, driver)
call("PATCH", f'/pool/shipments/{shipment_a["_id"]}/state', {"state": "ARRIVED"}, driver)

wrong_otp = call("PATCH", f'/pool/shipments/{shipment_a["_id"]}/state',
                 {"state": "PICKED_UP", "otp": "000000"}, driver)
check("a wrong pickup code is refused", error_of(wrong_otp) is not None, error_of(wrong_otp))

mine = call("GET", "/pool/shipments/mine", token=farmer_a)
otp = next((s.get("pickupOtp") for s in mine if s["_id"] == shipment_a["_id"]), None)
picked = call("PATCH", f'/pool/shipments/{shipment_a["_id"]}/state',
              {"state": "PICKED_UP", "otp": otp}, driver)
check("the right pickup code loads the produce", picked.get("state") == "PICKED_UP",
      picked.get("state") or error_of(picked))

loaded = call("GET", f"/pool/trips/{trip_id}", token=driver)
check("loaded weight now reflects what is aboard",
      loaded["trip"]["capacity"]["loadedKg"] == 1000,
      loaded["trip"]["capacity"]["loadedKg"])

print()
print("=== 11. the admin console sees all of it ===")
admin = call("POST", "/admin/login", {"username": "admin", "password": "admin"})["token"]
stats = call("GET", "/admin/stats", token=admin)
check("admin sees platform KPIs", stats["users"]["total"] > 0,
      f'{stats["users"]["total"]} users, {stats["trips"]["active"]} active trips')
check("admin sees pooled shipments", stats["pooling"]["shipments"] >= 2,
      stats["pooling"]["shipments"])

live = call("GET", "/admin/live", token=admin)
check("admin sees the live trip", any(t["_id"] == trip_id for t in live["trips"]),
      f'{len(live["trips"])} active')

bookings = call("GET", "/admin/requests", token=admin)
check("admin separates accepted from confirmed",
      "awaitingFarmer" in bookings["totals"] and "confirmed" in bookings["totals"],
      f'{bookings["totals"]["awaitingFarmer"]} awaiting, {bookings["totals"]["confirmed"]} confirmed')

mandis = call("GET", "/admin/mandis", token=admin)
check("admin sees demand by mandi", any(m["name"] == "Lasalgaon Mandi" for m in mandis),
      f"{len(mandis)} mandis")

ai = call("GET", "/admin/ai", token=admin)
check("admin sees AI activity and language mix", "byLanguage" in ai, ai["totals"])

billing = call("GET", "/admin/billing", token=admin)
check("admin sees settlements", "totals" in billing,
      f'billed {billing["totals"]["billed"]}')

marketplace_token_on_admin = call("GET", "/admin/stats", token=farmer_a)
check("a farmer token cannot reach /admin", error_of(marketplace_token_on_admin) == "AUTH_FORBIDDEN",
      error_of(marketplace_token_on_admin))

print()
print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
