#!/usr/bin/env python3
"""
The Backhaul Network, end to end (ADR-039).

The assertions this suite exists for:

    1. THE RETURN NEVER TOUCHES THE OUTBOUND.  A return leg cannot open while a
       single farmer's produce is still aboard, so a backhaul can never compete
       with the trip the farmers paid for.

    2. CARGO RULES ARE A BOUNDARY, NOT A FILTER.  A vehicle type that may not
       carry a category is refused server-side, whatever the client sends.

    3. THE PRICE IS HONEST.  Detour is charged whole to the load that caused it,
       carriage is charged in proportion to the capacity it occupies, and the
       driver is never shown a "free return".

    4. ONE LOAD, ONE DRIVER.  Two transporters accepting the same return load at
       the same instant: exactly one gets it.

Run against a live server on a freshly seeded database:

    npm run seed -- --reset && python3 tests/08_backhaul.py
"""
import json
import threading
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

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
        raise SystemExit(f"cannot sign in {phone}: {otp.get('__error')} {otp.get('__message','')}")
    session = call("POST", "/auth/verify-otp", {"phone": phone, "code": otp["devCode"]})
    _sessions[phone] = (session["accessToken"], session["user"])
    return _sessions[phone]


def iso(dt):
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


NOW = datetime.now(timezone.utc)
LASALGAON = {"name": "Lasalgaon Mandi", "lat": 20.1417, "lng": 74.2389}
PIMPRI = {"name": "Pimpri, Pune", "lat": 18.6298, "lng": 73.7997}
RUPEE = 0.02

print("=== 1. the cast ===")
driver, driver_user = login("9000000002", "TRANSPORTER")   # 4t truck
farmer, farmer_user = login("9000000001", "FARMER")
shopkeeper, shop_user = login("9000000008", "FARMER")      # Krishi Seva Kendra
tractor_driver, _ = login("9000000004", "TRANSPORTER")     # TEMPO, 1.5t

vehicle = call("GET", "/vehicles/me", token=driver)
check("the driver has a 4t truck", vehicle["capacityKg"] == 4000, f'{vehicle["vehicleType"]} {vehicle["capacityKg"]}kg')

print()
print("=== 2. cargo rules are published and enforced ===")
rules = call("GET", "/backhaul/cargo-categories", token=farmer)
check("the cargo rulebook is served to the app",
      isinstance(rules, list) and len(rules) >= 5,
      f'{len(rules)} categories')
crates = next((r for r in rules if r["key"] == "EMPTY_CRATES"), None)
construction = next((r for r in rules if r["key"] == "CONSTRUCTION_MATERIAL"), None)
check("a tractor may carry empty crates",
      crates is not None and "TRACTOR" in crates["allowedVehicleTypes"],
      ", ".join(crates["allowedVehicleTypes"]) if crates else "?")
check("a tractor may NOT carry construction material",
      construction is not None and "TRACTOR" not in construction["allowedVehicleTypes"],
      ", ".join(construction["allowedVehicleTypes"]) if construction else "?")

overweight = call(
    "POST",
    "/backhaul/requests",
    {
        "cargoCategory": "EMPTY_CRATES",
        "description": "Far too many crates",
        "weightKg": 9000,
        "pickup": LASALGAON,
        "destination": PIMPRI,
        "readyFrom": iso(NOW),
        "readyUntil": iso(NOW + timedelta(hours=8)),
    },
    shopkeeper,
)
check("a load over its category's weight ceiling is refused",
      error_of(overweight) == "VALIDATION_ERROR",
      overweight.get("__message", ""))

print()
print("=== 3. a return load can exist without a farmer or a crop ===")
load = call(
    "POST",
    "/backhaul/requests",
    {
        "cargoCategory": "GROCERY_RETAIL",
        "description": "Shop restock — rice and oil",
        "weightKg": 800,
        "pickup": {"name": "Lasalgaon Market", "lat": 20.1465, "lng": 74.2405},
        "destination": {"name": "Manchar", "lat": 19.0038, "lng": 73.9403},
        "readyFrom": iso(NOW - timedelta(hours=1)),
        "readyUntil": iso(NOW + timedelta(hours=10)),
    },
    shopkeeper,
)
check("a shopkeeper posts a return load", error_of(load) is None, str(error_of(load)))
check("it needs no crop, no mandi and no farmer",
      load.get("state") == "OPEN" and "cropType" not in load,
      "BackhaulRequest is its own model")

print()
print("=== 4. an outbound trip has to finish first ===")
request = call(
    "POST",
    "/transport/requests",
    {
        "cropType": "Onion",
        "quantityKg": 1200,
        "pickup": PIMPRI,
        "destination": LASALGAON,
        "preferredDate": iso(NOW + timedelta(days=1)),
    },
    farmer,
)
claim = call("POST", f'/pool/requests/{request["_id"]}/claim', {}, driver)
offers = call("GET", f'/pool/requests/{request["_id"]}/offers', token=farmer)
chosen = next((o for o in offers if o["_id"] == claim["_id"]), None)
selected = call("POST", f'/pool/requests/{request["_id"]}/select', {"offerId": chosen["_id"]}, farmer)
TRIP_ID = selected["trip"]["_id"]
check("a V1 outbound trip is running", bool(TRIP_ID), TRIP_ID)

too_early = call("POST", f"/backhaul/trips/{TRIP_ID}/return-leg/open", {}, driver)
check("the return leg cannot open with produce still aboard",
      error_of(too_early) == "BOOKING_STATE_INVALID",
      too_early.get("__message", ""))

# run the outbound leg to delivery
trip = call("GET", f"/pool/trips/{TRIP_ID}", token=driver)
shipment = trip["shipments"][0]
farmer_view = call("GET", f"/pool/trips/{TRIP_ID}", token=farmer)
otp = next(s for s in farmer_view["shipments"] if s["farmerId"] == farmer_user["_id"])["pickupOtp"]

call("PATCH", f"/pool/trips/{TRIP_ID}/state", {"state": "EN_ROUTE"}, driver)
for body in (
    {"state": "EN_ROUTE"},
    {"state": "ARRIVED"},
    {"state": "PICKED_UP", "otp": otp},
    {"state": "IN_TRANSIT"},
    {"state": "DELIVERED"},
):
    step = call("PATCH", f'/pool/shipments/{shipment["_id"]}/state', body, driver)
    if error_of(step):
        raise SystemExit(f'outbound leg failed at {body["state"]}: {step.get("__message")}')
check("every farmer load is delivered", True, "the outbound trip is done")

print()
print("=== 5. the return leg opens ===")
opened = call("POST", f"/backhaul/trips/{TRIP_ID}/return-leg/open", {}, driver)
check("the return leg opens once the vehicle is empty",
      error_of(opened) is None and opened["trip"]["returnLeg"]["state"] == "OPEN",
      str(error_of(opened)))
check("the empty run it is recovering is measured",
      opened["trip"]["returnLeg"]["emptyReturnKm"] > 100,
      f'{opened["trip"]["returnLeg"]["emptyReturnKm"]} km home empty')
check("the whole vehicle is free for the return",
      opened["capacity"]["availableKg"] == 4000,
      f'{opened["capacity"]["availableKg"]}kg')

print()
print("=== 6. matching ranks by more than the fare ===")
matches = call("GET", f"/backhaul/trips/{TRIP_ID}/return-loads", token=driver)
check("compatible return loads are found",
      matches["open"] and len(matches["matches"]) > 0,
      f'{len(matches["matches"])} load(s)')

rows = matches["matches"]
if rows:
    top = rows[0]
    check("every row shows the added kilometres, not just the money",
          all(k in top for k in ("detourKm", "addedMinutes", "carryKm", "expectedEarning")),
          f'+{top["detourKm"]}km · +{top["addedMinutes"]}min · ₹{top["expectedEarning"]}')
    check("no load is priced as a free return",
          all(r["expectedEarning"] > 0 for r in rows),
          " ".join(f'₹{r["expectedEarning"]}' for r in rows[:4]))
    check("the ranking is explained in words",
          all(r["fitReason"] for r in rows),
          top["fitReason"])
    check("rows are ordered by fit, best first",
          all(rows[i]["fitScore"] >= rows[i + 1]["fitScore"] for i in range(len(rows) - 1)),
          " ".join(str(r["fitScore"]) for r in rows))
    check("empty kilometres recovered are reported",
          all(r["emptyKmRecovered"] >= 0 for r in rows),
          f'top row turns {top["emptyKmRecovered"]} empty km into paid km')

print()
print("=== 7. an incompatible destination is not offered ===")
wrong_way = call(
    "POST",
    "/backhaul/requests",
    {
        "cargoCategory": "GENERAL_GOODS",
        "description": "Going the opposite way entirely",
        "weightKg": 500,
        "pickup": {"name": "Nagpur", "lat": 21.1458, "lng": 79.0882},
        "destination": {"name": "Bhandara", "lat": 21.1667, "lng": 79.65},
        "readyFrom": iso(NOW),
        "readyUntil": iso(NOW + timedelta(hours=10)),
    },
    shopkeeper,
)
after = call("GET", f"/backhaul/trips/{TRIP_ID}/return-loads", token=driver)
check("a load 400 km off the route home is not offered",
      not any(m["request"]["_id"] == wrong_way["_id"] for m in after["matches"]),
      "filtered on real detour, not just proximity")

print()
print("=== 8. eligibility is enforced on accept, not just in the list ===")
heavy = call(
    "POST",
    "/backhaul/requests",
    {
        "cargoCategory": "CONSTRUCTION_MATERIAL",
        "description": "Sand and cement",
        "weightKg": 1200,
        "pickup": {"name": "Lasalgaon", "lat": 20.1502, "lng": 74.2321},
        "destination": {"name": "Narayangaon", "lat": 19.0742, "lng": 73.9375},
        "readyFrom": iso(NOW),
        "readyUntil": iso(NOW + timedelta(hours=10)),
    },
    shopkeeper,
)
tempo_vehicle = call("GET", "/vehicles/me", token=tractor_driver)
check("a second driver has a TEMPO", tempo_vehicle["vehicleType"] == "TEMPO",
      f'{tempo_vehicle["vehicleType"]} {tempo_vehicle["capacityKg"]}kg')

# a TEMPO is not on the construction-material whitelist — try to force it anyway
forced = call(
    "POST",
    f'/backhaul/trips/{TRIP_ID}/return-loads/{heavy["_id"]}/accept',
    {},
    tractor_driver,
)
check("another driver cannot accept onto someone else's trip",
      error_of(forced) == "AUTH_FORBIDDEN", str(error_of(forced)))

print()
print("=== 9. accepting a return load ===")
target = rows[0]["request"]
accepted = call(
    "POST", f'/backhaul/trips/{TRIP_ID}/return-loads/{target["_id"]}/accept', {}, driver
)
check("the driver takes the load", error_of(accepted) is None, str(error_of(accepted)))

booking = accepted["booking"]
quote = accepted["quote"]
check("the price is detour + carriage, nothing invented",
      abs(quote["price"] - (quote["detourCost"] + quote["carriageCost"])) < RUPEE,
      f'₹{quote["detourCost"]} detour + ₹{quote["carriageCost"]} carriage = ₹{quote["price"]}')
check("the detour is charged whole to the load that caused it",
      quote["detourKm"] >= 0 and quote["detourCost"] >= 0,
      f'{quote["detourKm"]} km → ₹{quote["detourCost"]}')
check("carriage is proportional to the capacity used",
      quote["utilisationPct"] > 0 and quote["utilisationPct"] <= 100,
      f'{quote["utilisationPct"]}% of the vehicle')
check("the driver's share and the platform fee sum to the price",
      abs(quote["transporterEarning"] + quote["platformFee"] - quote["price"]) < RUPEE,
      f'₹{quote["transporterEarning"]} + ₹{quote["platformFee"]}')
check("return capacity is now reserved",
      accepted["capacity"]["availableKg"] == 4000 - booking["weightKg"],
      f'{accepted["capacity"]["availableKg"]}kg free of 4000')

again = call("GET", f"/backhaul/trips/{TRIP_ID}/return-loads", token=driver)
check("a booked load leaves the pool",
      not any(m["request"]["_id"] == target["_id"] for m in again["matches"]),
      "one load, one driver")

duplicate = call(
    "POST", f'/backhaul/trips/{TRIP_ID}/return-loads/{target["_id"]}/accept', {}, driver
)
check("the same load cannot be accepted twice",
      error_of(duplicate) in ("CONCURRENT_BOOKING", "BOOKING_STATE_INVALID", "RESOURCE_NOT_FOUND"),
      str(error_of(duplicate)))

print()
print("=== 10. multiple return loads share the leg ===")
second = next((m for m in again["matches"] if m["request"]["weightKg"] <= again["capacity"]["availableKg"]), None)
if second:
    added = call(
        "POST",
        f'/backhaul/trips/{TRIP_ID}/return-loads/{second["request"]["_id"]}/accept',
        {},
        driver,
    )
    check("a second return load joins the same leg", error_of(added) is None, str(error_of(added)))
    check("capacity accounts for both",
          added["capacity"]["bookedKg"] == booking["weightKg"] + second["request"]["weightKg"],
          f'{added["capacity"]["bookedKg"]}kg aboard for the return')
else:
    check("a second return load joins the same leg", False, "no compatible second load in the pool")

print()
print("=== 11. capacity is protected on the return too ===")
huge = call(
    "POST",
    "/backhaul/requests",
    {
        "cargoCategory": "ANIMAL_FEED",
        "description": "More feed than the truck can hold",
        "weightKg": 5000,
        "pickup": {"name": "Lasalgaon", "lat": 20.1502, "lng": 74.2321},
        "destination": {"name": "Narayangaon", "lat": 19.0742, "lng": 73.9375},
        "readyFrom": iso(NOW),
        "readyUntil": iso(NOW + timedelta(hours=10)),
    },
    shopkeeper,
)
overload = call(
    "POST", f'/backhaul/trips/{TRIP_ID}/return-loads/{huge["_id"]}/accept', {}, driver
)
check("a load beyond the remaining return capacity is refused",
      error_of(overload) in ("CAPACITY_EXCEEDED", "VALIDATION_ERROR"),
      f'{error_of(overload)} — {overload.get("__message","")}')

print()
print("=== 12. THE RACE: two drivers, one return load ===")
racer_load = call(
    "POST",
    "/backhaul/requests",
    {
        "cargoCategory": "EMPTY_CRATES",
        "description": "Crates everyone wants",
        "weightKg": 200,
        "pickup": {"name": "Lasalgaon", "lat": 20.1502, "lng": 74.2321},
        "destination": {"name": "Chinchwad, Pune", "lat": 18.6298, "lng": 73.7997},
        "readyFrom": iso(NOW),
        "readyUntil": iso(NOW + timedelta(hours=10)),
    },
    shopkeeper,
)

results = {}


def grab(name):
    results[name] = call(
        "POST", f'/backhaul/trips/{TRIP_ID}/return-loads/{racer_load["_id"]}/accept', {}, driver
    )


threads = [threading.Thread(target=grab, args=(n,)) for n in ("A", "B")]
for t in threads:
    t.start()
for t in threads:
    t.join()

wins = [k for k, v in results.items() if error_of(v) is None]
check("exactly one acceptance succeeds", len(wins) == 1,
      f'{len(wins)} won, {2 - len(wins)} refused')
check("the loser gets a clear reason",
      all(error_of(results[k]) in ("CONCURRENT_BOOKING", "CAPACITY_EXCEEDED")
          for k in results if error_of(results[k])),
      " ".join(error_of(v) or "won" for v in results.values()))

print()
print("=== 13. the return trip runs and pays ===")
leg = call("GET", f"/backhaul/trips/{TRIP_ID}/return-leg", token=driver)
first_booking = leg["bookings"][0]
check("the driver never sees the collection code",
      not first_booking.get("pickupOtp"), "hidden from the carrier")

requester_view = call("GET", "/backhaul/requests/mine", token=shopkeeper)
mine = next((r for r in requester_view if r.get("booking")
             and r["booking"]["_id"] == first_booking["_id"]), None)
collection_otp = mine["booking"]["pickupOtp"] if mine else None
check("the requester holds the collection code", bool(collection_otp), collection_otp or "missing")

bad = call("PATCH", f'/backhaul/bookings/{first_booking["_id"]}/state',
           {"state": "PICKED_UP", "otp": "0000"}, driver)
check("a wrong collection code is refused", error_of(bad) == "VALIDATION_ERROR",
      str(error_of(bad)))

for state, body in (
    ("PICKED_UP", {"state": "PICKED_UP", "otp": collection_otp}),
    ("IN_TRANSIT", {"state": "IN_TRANSIT"}),
    ("DELIVERED", {"state": "DELIVERED"}),
):
    step = call("PATCH", f'/backhaul/bookings/{first_booking["_id"]}/state', body, driver)
    check(f"the return load reaches {state}",
          error_of(step) is None and step["booking"]["state"] == state,
          str(error_of(step)))

print()
print("=== 14. the round trip, in one number ===")
final = call("GET", f"/backhaul/trips/{TRIP_ID}/return-leg", token=driver)
u = final["utilisation"]
check("both legs are measured",
      u["outboundKm"] > 0 and u["returnKm"] > 0,
      f'{u["outboundKm"]}km out + {u["returnKm"]}km back = {u["totalKm"]}km')
check("the return adds real earning on top of the outbound",
      u["returnEarning"] > 0 and abs(u["totalEarning"] - (u["outboundEarning"] + u["returnEarning"])) < RUPEE,
      f'₹{u["outboundEarning"]} + ₹{u["returnEarning"]} = ₹{u["totalEarning"]}')
check("utilisation is a percentage of the whole round trip",
      0 < u["utilisationPct"] <= 100,
      f'{u["utilisationPct"]}% of {u["totalKm"]}km driven loaded')
check("empty kilometres recovered are reported",
      u["emptyKmRecovered"] > 0,
      f'{u["emptyKmRecovered"]} km that would have been driven empty')

print()
print("=== 15. V1 is untouched ===")
v1_trip = call("GET", f"/pool/trips/{TRIP_ID}", token=driver)
check("the outbound trip still prices exactly as before",
      v1_trip["pricing"] is not None and v1_trip["pricing"]["totalCost"] > 0,
      f'₹{v1_trip["pricing"]["totalCost"]} across {v1_trip["pricing"]["poolSize"]} farmer(s)')
check("the farmer's outbound share is unchanged by any of this",
      abs(sum(s["amount"] for s in v1_trip["pricing"]["shares"]) - v1_trip["pricing"]["totalCost"]) < RUPEE,
      "outbound shares still sum to the outbound total")

print()
print("=== 12. the return leg is recoverable, not just correct (ADR-045) ===")
# The Blackout brief asks specifically that machinery, backhaul AND the return
# leg be covered by the recovery journal. This suite is the only place that
# actually drives a trip all the way to an open return leg with a booked load, so
# the journal assertions live here rather than being simulated elsewhere.
_admin = call("POST", "/admin/login", {"username": "admin", "password": "admin"})["token"]

# drive one real return-leg transition so BOTH journalled paths — opening it and
# advancing it — are exercised against live state rather than asserted about.
# (OPEN → LOADING happens as a side effect of accepting the first load, and is
# covered by BACKHAUL_BOOKING_CREATED's own replay, so the explicit transition
# to test is the next one.)
_advanced = call("PATCH", f"/backhaul/trips/{TRIP_ID}/return-leg/state", {"state": "IN_TRANSIT"}, driver)
check("the return leg advances", error_of(_advanced) is None
      and _advanced["trip"]["returnLeg"]["state"] == "IN_TRANSIT", str(error_of(_advanced)))

_journal = call("GET", "/admin/resilience/journal?limit=500", token=_admin)
_events = _journal["events"]


def _committed(kind, entity=None):
    return [
        e for e in _events
        if e["eventType"] == kind
        and e["state"] in ("COMMITTED", "REPLAYED", "SUPERSEDED")
        and (entity is None or e["entityId"] == entity)
    ]


check("opening the return leg is journalled as a recoverable transition",
      any(e["payload"].get("toState") == "OPEN" for e in _committed("RETURN_LEG_STATE_CHANGED", TRIP_ID)),
      str([e["payload"].get("toState") for e in _committed("RETURN_LEG_STATE_CHANGED", TRIP_ID)]))
check("advancing the return leg is journalled too",
      any(e["payload"].get("toState") == "IN_TRANSIT"
          for e in _committed("RETURN_LEG_STATE_CHANGED", TRIP_ID)),
      str([e["payload"].get("toState") for e in _committed("RETURN_LEG_STATE_CHANGED", TRIP_ID)]))
check("accepting a return load is journalled",
      bool(_committed("BACKHAUL_BOOKING_CREATED")),
      f'{len(_committed("BACKHAUL_BOOKING_CREATED"))} acceptance(s) recorded')
check("every return-load state change is journalled",
      bool(_committed("BACKHAUL_BOOKING_STATE_CHANGED")),
      f'{len(_committed("BACKHAUL_BOOKING_STATE_CHANGED"))} transition(s) recorded')
check("each carries a stable idempotency key",
      all(len(e["operationKey"]) >= 16
          for e in _committed("RETURN_LEG_STATE_CHANGED") + _committed("BACKHAUL_BOOKING_CREATED")))
check("no collection code ever reaches the journal",
      not any(k in json.dumps([e["payload"] for e in _events]).lower()
              for k in ("otp", "pickupotp", "startotp", "secret", "token")))

_before_replay = call("GET", f"/backhaul/trips/{TRIP_ID}/return-leg", token=driver)
_replay = call("POST", "/admin/resilience/replay", {}, _admin)
_after_replay = call("GET", f"/backhaul/trips/{TRIP_ID}/return-leg", token=driver)
check("replaying the journal creates no second return-load booking and no state drift",
      error_of(_replay) is None
      and len(_after_replay["bookings"]) == len(_before_replay["bookings"])
      and _after_replay["returnLeg"]["state"] == _before_replay["returnLeg"]["state"],
      f'{len(_after_replay["bookings"])} booking(s), leg {_after_replay["returnLeg"]["state"]}')

print()
print(f"{passed} passed, {failed} failed")
raise SystemExit(1 if failed else 0)
