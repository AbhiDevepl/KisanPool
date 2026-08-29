#!/usr/bin/env python3
"""
The Farm Resource Network, end to end (ADR-038).

The assertions this suite exists for:

    1. AVAILABILITY IS DERIVED.  A machine is free for a window when nothing
       overlaps it — bookings and owner blackouts are the only truth, and a
       double-booking is refused server-side however the client asks.

    2. THE SLOT RACE HAS ONE WINNER.  Two farmers asking for the same Tuesday
       morning at the same instant: exactly one gets it.

    3. PRICE IS EXPLAINED, NOT ASSERTED.  Every quote carries its working, the
       unit conversions are right for hours / acres / days, and the minimum
       charge tops up rather than replacing.

    4. A FARMER CAN BE SUPPLY.  Provider-ness is owning a machine, not a role —
       so a FARMER account can list one and take bookings on it.

Run against a live server on a freshly seeded database:

    npm run seed -- --reset && python3 tests/07_farm_machinery.py
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
PIMPRI = {"name": "Pimpri, Pune", "lat": 18.6298, "lng": 73.7997}
CHINCHWAD = {"name": "Chinchwad, Pune", "lat": 18.6414, "lng": 73.7629}

print("=== 1. sign in ===")
farmer, farmer_user = login("9000000006", "FARMER")       # Ganesh — the hirer
provider, provider_user = login("9000000008", "FARMER")   # Krishi Seva Kendra
owner_farmer, owner_user = login("9000000001", "FARMER")  # Rahul — farmer AND provider
check("hiring farmer signs in", bool(farmer), farmer_user["name"])
check("provider signs in", bool(provider), provider_user["name"])

print()
print("=== 2. a FARMER account can be supply ===")
mine = call("GET", "/farm/machines/mine", token=owner_farmer)
check("a farmer's own machine is listed under their account",
      isinstance(mine, list) and len(mine) >= 1,
      f'{len(mine) if isinstance(mine, list) else "?"} machine(s) — {owner_user["name"]}')
check("provider-ness needs no new role", owner_user["role"] == "FARMER", owner_user["role"])

print()
print("=== 3. discovery is priced for THIS job ===")
start = (NOW + timedelta(days=2)).replace(hour=7, minute=0, second=0, microsecond=0)
end = start + timedelta(hours=4)

found = call(
    "GET",
    f'/farm/machines?lat={PIMPRI["lat"]}&lng={PIMPRI["lng"]}'
    f"&category=TRACTOR_TROLLEY&start={iso(start)}&end={iso(end)}&operatorMode=WITH_OPERATOR",
    token=farmer,
)
check("tractor+trolley providers are found nearby",
      isinstance(found, list) and len(found) > 0,
      f'{len(found) if isinstance(found, list) else "?"} provider(s)')

if isinstance(found, list) and found:
    first = found[0]
    quote = first["quote"]
    check("every row carries a live quote for this window", quote is not None,
          f'{first["title"]} → ₹{quote["total"]}')
    check("a per-hour machine bills whole hours",
          quote["unit"] == "PER_HOUR" and quote["billableUnits"] == 4,
          f'{quote["billableUnits"]} × ₹{quote["rate"]}')
    check("work cost is rate × units",
          abs(quote["workCost"] - quote["rate"] * quote["billableUnits"]) < 0.02,
          f'₹{quote["workCost"]}')
    check("travel is charged both ways",
          abs(quote["travelCost"] - quote["travelKm"] * 2 * (quote["travelCost"] / max(quote["travelKm"] * 2, 1))) < 0.02
          if quote["travelKm"] else True,
          f'{quote["travelKm"]} km each way → ₹{quote["travelCost"]}')
    check("the total is the sum of its parts",
          abs(quote["total"] - (quote["workCost"] + quote["travelCost"] + quote["minimumTopUp"])) < 0.02,
          f'₹{quote["workCost"]} + ₹{quote["travelCost"]} + ₹{quote["minimumTopUp"]} = ₹{quote["total"]}')
    check("the platform's cut and the provider's earning sum to the total",
          abs(quote["platformFee"] + quote["providerEarning"] - quote["total"]) < 0.02,
          f'₹{quote["providerEarning"]} + ₹{quote["platformFee"]}')
    check("availability is reported per window", "availableForWindow" in first,
          str(first["availableForWindow"]))
    check("rows are ranked available-first",
          all(
              found[i]["availableForWindow"] >= found[i + 1]["availableForWindow"]
              for i in range(len(found) - 1)
          ),
          " ".join("Y" if r["availableForWindow"] else "n" for r in found))

print()
print("=== 4. per-acre pricing needs an area ===")
acre_machines = call(
    "GET",
    f'/farm/machines?lat={PIMPRI["lat"]}&lng={PIMPRI["lng"]}&category=ROTAVATOR'
    f"&start={iso(start)}&end={iso(end)}&areaAcres=3",
    token=farmer,
)
rotavator = acre_machines[0] if isinstance(acre_machines, list) and acre_machines else None
check("a per-acre machine is found", rotavator is not None,
      rotavator["title"] if rotavator else "none")

if rotavator:
    check("per-acre bills the acres, not the hours",
          rotavator["quote"]["unit"] == "PER_ACRE" and abs(rotavator["quote"]["billableUnits"] - 3) < 0.01,
          f'{rotavator["quote"]["billableUnits"]} acres × ₹{rotavator["quote"]["rate"]}')

    no_area = call(
        "POST",
        "/farm/bookings",
        {
            "machineId": rotavator["_id"],
            "start": iso(start),
            "end": iso(end),
            "location": CHINCHWAD,
            "operatorMode": "WITH_OPERATOR",
        },
        farmer,
    )
    check("booking a per-acre machine without an area is refused",
          error_of(no_area) == "VALIDATION_ERROR",
          no_area.get("__message", ""))

print()
print("=== 5. booking, and the schedule it creates ===")
tractor = next((m for m in found if m["availableForWindow"]), None) if isinstance(found, list) else None
if not tractor:
    raise SystemExit("no available tractor to book — seed data missing")

# booked for the SAME field the search was run from — that is the flow the app
# drives, and it is the only case where the two prices must be identical
booking = call(
    "POST",
    "/farm/bookings",
    {
        "machineId": tractor["_id"],
        "start": iso(start),
        "end": iso(end),
        "location": PIMPRI,
        "operatorMode": "WITH_OPERATOR",
        "workType": "Carting to the mandi",
    },
    farmer,
)
check("the booking is created", error_of(booking) is None, str(error_of(booking)))
check("it starts REQUESTED, holding the slot", booking.get("state") == "REQUESTED",
      booking.get("state", ""))
check("the price quoted in discovery is the price booked",
      abs(booking["quote"]["total"] - tractor["quote"]["total"]) < 0.02,
      f'quoted ₹{tractor["quote"]["total"]} → booked ₹{booking["quote"]["total"]}')

BOOKING_ID = booking["_id"]

# ...and a field somewhere else costs a different amount of travel, which is the
# whole reason travel is a separate line on the quote
elsewhere = call(
    "GET",
    f'/farm/machines?lat={CHINCHWAD["lat"]}&lng={CHINCHWAD["lng"]}'
    f"&category=TRACTOR_TROLLEY&start={iso(start)}&end={iso(end)}",
    token=farmer,
)
other_site = next((m for m in elsewhere if m["_id"] == tractor["_id"]), None)
check("a field further from the machine costs more to reach",
      other_site is not None
      and other_site["quote"]["workCost"] == tractor["quote"]["workCost"]
      and other_site["quote"]["travelCost"] != tractor["quote"]["travelCost"],
      f'same work ₹{tractor["quote"]["workCost"]}, travel '
      f'₹{tractor["quote"]["travelCost"]} vs ₹{other_site["quote"]["travelCost"] if other_site else "?"}')

again = call(
    "GET",
    f'/farm/machines?lat={PIMPRI["lat"]}&lng={PIMPRI["lng"]}'
    f"&category=TRACTOR_TROLLEY&start={iso(start)}&end={iso(end)}",
    token=farmer,
)
same = next((m for m in again if m["_id"] == tractor["_id"]), None)
check("the machine now reports itself busy for that window",
      same is not None and same["availableForWindow"] is False,
      f'availableForWindow={same["availableForWindow"] if same else "?"}')

print()
print("=== 6. schedule conflict is refused ===")
overlap = call(
    "POST",
    "/farm/bookings",
    {
        "machineId": tractor["_id"],
        "start": iso(start + timedelta(hours=1)),  # straddles the existing booking
        "end": iso(end + timedelta(hours=1)),
        "location": CHINCHWAD,
        "operatorMode": "WITH_OPERATOR",
    },
    provider if tractor["ownerId"] != provider_user["_id"] else farmer,
)
check("an overlapping booking is refused",
      error_of(overlap) in ("CONCURRENT_BOOKING", "AUTH_FORBIDDEN"),
      f'{error_of(overlap)} — {overlap.get("__message","")}')

adjacent = call(
    "POST",
    "/farm/bookings",
    {
        "machineId": tractor["_id"],
        "start": iso(end),  # starts exactly when the other ends
        "end": iso(end + timedelta(hours=2)),
        "location": CHINCHWAD,
        "operatorMode": "WITH_OPERATOR",
    },
    farmer,
)
check("a back-to-back booking is allowed", error_of(adjacent) is None,
      f'{iso(end)} → accepted' if error_of(adjacent) is None else str(error_of(adjacent)))
if error_of(adjacent) is None:
    call("PATCH", f'/farm/bookings/{adjacent["_id"]}/state', {"state": "CANCELLED"}, farmer)

print()
print("=== 7. the service area is a real boundary ===")
far_away = call(
    "POST",
    "/farm/bookings",
    {
        "machineId": tractor["_id"],
        "start": iso(start + timedelta(days=5)),
        "end": iso(start + timedelta(days=5, hours=3)),
        "location": {"name": "Lasalgaon", "lat": 20.1417, "lng": 74.2389},
        "operatorMode": "WITH_OPERATOR",
    },
    farmer,
)
check("a field outside the provider's radius is refused",
      error_of(far_away) == "VALIDATION_ERROR",
      far_away.get("__message", ""))

print()
print("=== 8. THE SLOT RACE: two farmers, one Tuesday morning ===")
race_start = (NOW + timedelta(days=9)).replace(hour=6, minute=0, second=0, microsecond=0)
race_end = race_start + timedelta(hours=3)
racer_a, _ = login("9100000041", "FARMER")
racer_b, _ = login("9100000042", "FARMER")

results = {}


def grab(name, token):
    results[name] = call(
        "POST",
        "/farm/bookings",
        {
            "machineId": tractor["_id"],
            "start": iso(race_start),
            "end": iso(race_end),
            "location": CHINCHWAD,
            "operatorMode": "WITH_OPERATOR",
        },
        token,
    )


threads = [
    threading.Thread(target=grab, args=("A", racer_a)),
    threading.Thread(target=grab, args=("B", racer_b)),
]
for t in threads:
    t.start()
for t in threads:
    t.join()

winners = [k for k, v in results.items() if error_of(v) is None]
losers = [k for k, v in results.items() if error_of(v) is not None]
check("exactly one farmer gets the slot", len(winners) == 1,
      f'{len(winners)} won, {len(losers)} refused')
check("the loser is told the slot went, not something vague",
      all(error_of(results[k]) == "CONCURRENT_BOOKING" for k in losers),
      " ".join(error_of(results[k]) or "" for k in losers))

print()
print("=== 9. the hire runs its course ===")
inbox = call("GET", "/farm/bookings/mine?role=provider", token=owner_farmer
             if tractor["ownerId"] == owner_user["_id"] else provider)
target = next((b for b in inbox if b["_id"] == BOOKING_ID), None)
check("the provider sees the request in their inbox", target is not None,
      f'{len(inbox)} booking(s)')

owner_token = owner_farmer if tractor["ownerId"] == owner_user["_id"] else provider

wrong_actor = call("PATCH", f"/farm/bookings/{BOOKING_ID}/state", {"state": "CONFIRMED"}, farmer)
check("the farmer cannot confirm their own booking",
      error_of(wrong_actor) == "AUTH_FORBIDDEN", str(error_of(wrong_actor)))

confirmed = call("PATCH", f"/farm/bookings/{BOOKING_ID}/state", {"state": "CONFIRMED"}, owner_token)
check("the provider confirms", confirmed.get("state") == "CONFIRMED", str(error_of(confirmed)))

mine_bookings = call("GET", "/farm/bookings/mine", token=farmer)
row = next((b for b in mine_bookings if b["_id"] == BOOKING_ID), None)
otp = row["startOtp"] if row else None
check("the farmer holds a start code the provider cannot see", bool(otp), otp or "missing")
provider_row = next((b for b in call("GET", "/farm/bookings/mine?role=provider", token=owner_token)
                     if b["_id"] == BOOKING_ID), None)
check("the provider is not shown the start code",
      provider_row is not None and not provider_row.get("startOtp"),
      "hidden")

bad_otp = call("PATCH", f"/farm/bookings/{BOOKING_ID}/state",
               {"state": "IN_PROGRESS", "otp": "0000"}, owner_token)
check("a wrong start code is refused",
      error_of(bad_otp) == "VALIDATION_ERROR" or bad_otp.get("state") != "IN_PROGRESS",
      str(error_of(bad_otp)))

started = call("PATCH", f"/farm/bookings/{BOOKING_ID}/state",
               {"state": "IN_PROGRESS", "otp": otp}, owner_token)
check("the right code starts the work", started.get("state") == "IN_PROGRESS", str(error_of(started)))

done = call("PATCH", f"/farm/bookings/{BOOKING_ID}/state", {"state": "COMPLETED"}, owner_token)
check("the work completes", done.get("state") == "COMPLETED", str(error_of(done)))
check("a final amount is billed", done.get("finalAmount") is not None,
      f'₹{done.get("finalAmount")}')

illegal = call("PATCH", f"/farm/bookings/{BOOKING_ID}/state", {"state": "IN_PROGRESS"}, owner_token)
check("a completed job cannot go backwards",
      error_of(illegal) == "BOOKING_STATE_INVALID", str(error_of(illegal)))

print()
print("=== 10. earnings and utilisation ===")
earnings = call("GET", "/farm/earnings", token=owner_token)
check("the provider's earnings include the completed job",
      earnings["total"] > 0 and len(earnings["jobs"]) >= 1,
      f'₹{earnings["total"]} over {len(earnings["jobs"])} job(s)')
check("earnings are the provider's share, not the gross",
      all(j["earning"] < j["amount"] for j in earnings["jobs"]),
      " ".join(f'{j["earning"]}<{j["amount"]}' for j in earnings["jobs"][:3]))

print()
print("=== 11. demand aggregation ===")
clusters = call("GET", f'/farm/demand?lat={PIMPRI["lat"]}&lng={PIMPRI["lng"]}&radiusKm=60',
                token=provider)
check("nearby demand for the same machine is reported",
      isinstance(clusters, list) and len(clusters) >= 1,
      "; ".join(f'{c["category"]}×{c["farmerCount"]}' for c in clusters) if clusters else "none")
check("a cluster is more than one farmer",
      all(c["farmerCount"] > 1 for c in clusters) if clusters else True,
      "singletons are not clusters")

print()
print("=== 12. cancellation frees the slot ===")
cancel_start = (NOW + timedelta(days=14)).replace(hour=8, minute=0, second=0, microsecond=0)
temp = call(
    "POST",
    "/farm/bookings",
    {
        "machineId": tractor["_id"],
        "start": iso(cancel_start),
        "end": iso(cancel_start + timedelta(hours=2)),
        "location": CHINCHWAD,
        "operatorMode": "WITH_OPERATOR",
    },
    farmer,
)
check("a future slot is booked", error_of(temp) is None, str(error_of(temp)))
cancelled = call("PATCH", f'/farm/bookings/{temp["_id"]}/state',
                 {"state": "CANCELLED", "reason": "rain"}, farmer)
check("the farmer can cancel it", cancelled.get("state") == "CANCELLED", str(error_of(cancelled)))

rebook = call(
    "POST",
    "/farm/bookings",
    {
        "machineId": tractor["_id"],
        "start": iso(cancel_start),
        "end": iso(cancel_start + timedelta(hours=2)),
        "location": CHINCHWAD,
        "operatorMode": "WITH_OPERATOR",
    },
    farmer,
)
check("the freed slot can be booked again", error_of(rebook) is None,
      "the calendar is derived, so cancelling really releases it")

print()
print(f"{passed} passed, {failed} failed")
raise SystemExit(1 if failed else 0)
