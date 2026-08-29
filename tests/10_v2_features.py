#!/usr/bin/env python3
"""
V2 targeted features (ADR-042):

    1. LIVE TRACK  — the Google Maps hand-off. Latest transporter position +
       destination mandi + a ready directions link, gated by BUSINESS STATE:
       not while forming, not once the farmer's load is delivered, not for a
       stranger, and the same stream for every farmer on a pooled trip.

    2. PICKUP LOCATION — a farmer can NAME a pickup, and that manual choice flows
       through the request payload, the stored TransportRequest, matching and
       pricing unchanged. Place search degrades to an offline gazetteer.

    3. SHARED-MACHINE UTILISATION — when nearby farmers book the same machine for
       compatible slots, the provider serves them in one outing and the round-trip
       travel splits across the jobs. Work cost never splits. Grouping is refused
       when the jobs are not actually near/soon.

Run against a live server on a freshly seeded database:

    npm run seed -- --reset && python3 tests/10_v2_features.py
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
        raise SystemExit(f"cannot sign in {phone}: {otp.get('__error')}")
    session = call("POST", "/auth/verify-otp", {"phone": phone, "code": otp["devCode"]})
    _sessions[phone] = (session["accessToken"], session["user"])
    return _sessions[phone]


def admin_login():
    result = call("POST", "/admin/login", {"username": "admin", "password": "admin"})
    return result["token"]


LASALGAON = {"name": "Lasalgaon Mandi", "lat": 20.1417, "lng": 74.2389}
NIPHAD = {"name": "Niphad, Nashik", "lat": 20.0805, "lng": 74.1099}
CHINCHWAD = {"name": "Chinchwad, Pune", "lat": 18.6414, "lng": 73.7629}


def confirm_trip(driver, farmer, request):
    claim = call("POST", f'/pool/requests/{request["_id"]}/claim', {}, driver)
    if error_of(claim):
        return {"__error": error_of(claim), "__message": claim.get("__message", "")}
    offers = call("GET", f'/pool/requests/{request["_id"]}/offers', token=farmer)
    mine = next((o for o in offers if o["_id"] == claim["_id"]), None)
    return call("POST", f'/pool/requests/{request["_id"]}/select', {"offerId": mine["_id"]}, farmer)


print("=== 1. the cast ===")
admin = admin_login()
driver, _ = login("9000000002", "TRANSPORTER")
a_token, a_user = login("9000000001", "FARMER")
b_token, b_user = login("9000000006", "FARMER")
c_token, c_user = login("9000000007", "FARMER")
provider, _ = login("9000000008", "FARMER")
check("everyone signed in", bool(admin and driver and a_token and b_token and c_token and provider))

print()
print("=== 2. pickup location: a manual place flows all the way through ===")
places = call("GET", "/maps/places?q=Niphad&near=18.63,73.80", token=a_token)
check("place search resolves a typed village", isinstance(places, list) and any("Niphad" in p["name"] for p in places),
      str(places[:1]))
check("search never 500s on a nonsense query",
      isinstance(call("GET", "/maps/places?q=zzzzznotaplace", token=a_token), list))

req = call("POST", "/transport/requests", {
    "cropType": "Onion", "quantityKg": 600, "pickup": NIPHAD, "destination": LASALGAON,
    "preferredDate": "2026-09-02T06:00:00.000Z",
}, a_token)
stored = call("GET", f'/transport/requests/{req["_id"]}', token=a_token)
check("the request stores the EXACT chosen pickup, not device GPS",
      stored["request"]["pickup"]["name"] == "Niphad, Nashik"
      and abs(stored["request"]["pickup"]["lat"] - 20.0805) < 1e-6,
      str(stored["request"]["pickup"]))

sel = confirm_trip(driver, a_token, req)
check("a booking forms from the manual pickup", error_of(sel) is None, str(error_of(sel)))
TRIP_ID = sel["trip"]["_id"]
trip = call("GET", f"/pool/trips/{TRIP_ID}", token=a_token)
mine = next(s for s in trip["shipments"] if s["farmerId"] == a_user["_id"])
check("the trip route is priced from the manual pickup (Niphad→Lasalgaon ≈ 20 km, not 220)",
      trip["pricing"]["effectiveRouteKm"] < 40,
      f'{trip["pricing"]["effectiveRouteKm"]} km')
check("the shipment carries the manual pickup into pricing",
      mine["pickup"]["name"] == "Niphad, Nashik"
      and abs(mine["pricing"]["rideKm"] - trip["pricing"]["effectiveRouteKm"]) < 1,
      f'rideKm {mine["pricing"]["rideKm"]}')

print()
print("=== 3. Live Track hand-off ===")
track = call("GET", f"/pool/trips/{TRIP_ID}/track", token=a_token)
check("a still-forming trip is NOT trackable", track["trackable"] is False and "not set off" in (track["reason"] or ""),
      track["reason"])

call("PATCH", f'/pool/trips/{TRIP_ID}/state', {"state": "EN_ROUTE"}, driver)
track = call("GET", f"/pool/trips/{TRIP_ID}/track", token=a_token)
check("once EN_ROUTE the trip is trackable", track["trackable"] is True, f'state {track["tripState"]}')
check("the deep link is a Google Maps directions URL to the mandi",
      track["directionsUrl"].startswith("https://www.google.com/maps/dir/?api=1")
      and f'{LASALGAON["lat"]},{LASALGAON["lng"]}' in track["directionsUrl"],
      track["directionsUrl"][:90])
check("the destination is the actual trip mandi", track["destination"]["name"] == "Lasalgaon Mandi")

# a fresh GPS position must be the origin
vehicles = call("GET", "/admin/vehicles", token=admin)
veh = next(v for v in vehicles if v.get("activeTrip") and v["activeTrip"]["_id"] == TRIP_ID)
call("PATCH", f'/admin/vehicles/{veh["_id"]}', {"currentLocation": {"lat": 20.05, "lng": 74.15}}, admin)
track = call("GET", f"/pool/trips/{TRIP_ID}/track", token=a_token)
check("the transporter's latest position is the route origin",
      track["origin"] == {"lat": 20.05, "lng": 74.15} and "origin=20.05,74.15" in track["directionsUrl"],
      track["directionsUrl"][:90])

outsider = call("GET", f"/pool/trips/{TRIP_ID}/track", token=b_token)
check("a farmer not on the trip is refused", error_of(outsider) == "AUTH_FORBIDDEN", str(error_of(outsider)))

# pooled: a second farmer on the SAME trip gets the SAME stream
req_b = call("POST", "/transport/requests", {
    "cropType": "Tomato", "quantityKg": 900, "pickup": NIPHAD, "destination": LASALGAON,
    "preferredDate": "2026-09-02T06:00:00.000Z",
}, b_token)
sel_b = confirm_trip(driver, b_token, req_b)
if error_of(sel_b) is None:
    track_b = call("GET", f"/pool/trips/{TRIP_ID}/track", token=b_token)
    check("every farmer on a pooled trip sees ONE stream (same origin + destination)",
          track_b["origin"] == track["origin"] and track_b["destination"] == track["destination"])

# business-state expiry: delivering this farmer's load ends tracking FOR THEM
otp = next(s for s in call("GET", f"/pool/trips/{TRIP_ID}", token=a_token)["shipments"]
           if s["farmerId"] == a_user["_id"])["pickupOtp"]
for body in ({"state": "EN_ROUTE"}, {"state": "ARRIVED"}, {"state": "PICKED_UP", "otp": otp},
             {"state": "IN_TRANSIT"}, {"state": "DELIVERED"}):
    call("PATCH", f'/pool/shipments/{mine["_id"]}/state', body, driver)
track = call("GET", f"/pool/trips/{TRIP_ID}/track", token=a_token)
check("tracking expires on DELIVERY, by state — no timer",
      track["trackable"] is False and "delivered" in (track["reason"] or "").lower(),
      track["reason"])

print()
print("=== 4. shared-machine utilisation: nearby jobs split the travel ===")
machines = call("GET", "/farm/machines?lat=19.00&lng=73.94&category=COMBINE_HARVESTER", token=a_token)
mid = machines[0]["_id"]
base = machines[0]["baseLocation"]
travel_rate = machines[0]["pricing"]["travelRatePerKm"]
check("the harvester charges for travel (so there is something to share)", travel_rate > 0, f'₹{travel_rate}/km')

def field(dlat, dlng, name):
    return {"name": name, "lat": base["lat"] + dlat, "lng": base["lng"] + dlng}

def book(tok, fld, acres, start, end):
    return call("POST", "/farm/bookings", {
        "machineId": mid, "start": start, "end": end, "location": fld,
        "operatorMode": "WITH_OPERATOR", "areaAcres": acres, "workType": "harvest",
    }, tok)

DAY = "2026-09-20"
SLOTS = [(f"{DAY}T03:30:00Z", f"{DAY}T05:30:00Z"),
         (f"{DAY}T05:30:00Z", f"{DAY}T07:30:00Z"),
         (f"{DAY}T07:30:00Z", f"{DAY}T09:30:00Z")]

b1 = book(a_token, field(0.02, 0.02, "Field A"), 2, *SLOTS[0])
check("first booking is solo — travel not shared", b1["quote"]["travelShareCount"] == 1,
      f'total ₹{b1["quote"]["total"]}, travel ₹{b1["quote"]["travelCost"]}')
solo_travel = b1["quote"]["travelCost"]
solo_work = b1["quote"]["workCost"]

b2 = book(b_token, field(0.03, 0.01, "Field B"), 3, *SLOTS[1])
b3 = book(c_token, field(0.01, 0.03, "Field C"), 2, *SLOTS[2])
check("the third compatible nearby booking triggers auto-grouping",
      b3.get("groupId") is not None, f'groupId {b3.get("groupId")}')

# re-read every farmer's booking — all three now share the outing
farmer_views = {name: call("GET", "/farm/bookings/mine?role=farmer", token=tok)[0]
                for name, tok in (("A", a_token), ("B", b_token), ("C", c_token))}
shares = {name: v["quote"]["travelShareCount"] for name, v in farmer_views.items()}
check("all three jobs now split the round trip", set(shares.values()) == {3}, str(shares))
check("each farmer's travel is their SHARE, not the whole trip",
      abs(farmer_views["A"]["quote"]["travelCost"] - solo_travel / 3) < 0.5,
      f'₹{farmer_views["A"]["quote"]["travelCost"]} vs solo ₹{solo_travel}')
check("work cost NEVER splits — an acre is an acre",
      abs(farmer_views["A"]["quote"]["workCost"] - solo_work) < 0.01,
      f'₹{farmer_views["A"]["quote"]["workCost"]}')
check("grouping lowered farmer A's bill",
      farmer_views["A"]["quote"]["total"] < b1["quote"]["total"],
      f'₹{b1["quote"]["total"]} → ₹{farmer_views["A"]["quote"]["total"]}')

# the provider sees the combined outing
prov_view = call("GET", "/farm/bookings/mine?role=provider", token=provider)
grouped = [b for b in prov_view if b.get("group")]
check("the provider sees the jobs as one grouped outing",
      len(grouped) >= 3 and grouped[0]["group"]["size"] == 3,
      f'{len(grouped)} grouped, size {grouped[0]["group"]["size"] if grouped else "-"}')
check("the provider's combined earning is the sum of the three jobs",
      grouped and abs(
          grouped[0]["group"]["combinedProviderEarning"]
          - sum(v["quote"]["providerEarning"] for v in farmer_views.values())
      ) < 1,
      f'₹{grouped[0]["group"]["combinedProviderEarning"]}' if grouped else "-")

# the two sides agree on the money
check("farmer total and provider combined total reconcile",
      grouped and abs(
          grouped[0]["group"]["combinedTotal"]
          - sum(v["quote"]["total"] for v in farmer_views.values())
      ) < 1)

print()
print("=== 5. grouping is refused when jobs are not actually near/soon ===")
far = call("POST", "/farm/bookings/group", {
    "bookingIds": [b1["_id"], "000000000000000000000000"],
}, provider)
check("grouping a missing booking is rejected", error_of(far) in ("RESOURCE_NOT_FOUND", "VALIDATION_ERROR"),
      str(error_of(far)))

# a genuinely distant job cannot be grouped with the cluster
d_token = a_token  # reuse; different field far away
far_field = {"name": "Far away", "lat": base["lat"] + 2.0, "lng": base["lng"] + 2.0}
# it will fail discovery radius, so book against a machine that reaches it is out of scope;
# instead assert the assessment says NONE for a far site
assess_far = call(
    "GET",
    f'/farm/machines/{mid}/grouping?lat={base["lat"] + 0.5}&lng={base["lng"] + 0.5}'
    f'&start={DAY}T03:30:00Z&end={DAY}T05:30:00Z&areaAcres=2',
    token=b_token,
)
check("a far-away prospective job is assessed NONE / LOW, never forced",
      assess_far["compatibility"] in ("NONE", "LOW"),
      f'{assess_far["compatibility"]} :: {assess_far["reasons"][0]}')

# a strongly compatible prospective job explains the saving
assess_near = call(
    "GET",
    f'/farm/machines/{mid}/grouping?lat={base["lat"] + 0.02}&lng={base["lng"] + 0.02}'
    f'&start={DAY}T09:30:00Z&end={DAY}T11:00:00Z&areaAcres=2',
    token=b_token,
)
check("a compatible prospective job reports a real projected saving with a reason",
      assess_near["projectedSaving"] > 0 and len(assess_near["reasons"]) >= 1,
      f'save ₹{assess_near["projectedSaving"]} :: {assess_near["reasons"][-1]}')

print()
print(f"{passed} passed, {failed} failed")
raise SystemExit(1 if failed else 0)
