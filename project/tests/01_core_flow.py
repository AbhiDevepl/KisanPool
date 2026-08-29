import json, urllib.request, urllib.error

API = "http://localhost:4000"

def call(method, path, body=None, token=None, expect_ok=True):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method)
    if body is not None:
        req.add_header("content-type", "application/json")
    if token:
        req.add_header("authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req) as res:
            payload = json.load(res)
    except urllib.error.HTTPError as e:
        payload = json.load(e)
    if expect_ok and not payload.get("success"):
        raise SystemExit(f"FAILED {method} {path}: {payload}")
    return payload

def login(phone, role):
    code = call("POST", "/auth/request-otp", {"phone": phone, "role": role})["data"]["devCode"]
    out = call("POST", "/auth/verify-otp", {"phone": phone, "code": code})["data"]
    return out["accessToken"], out["user"]

passed, failed = [], []
def check(name, cond, detail=""):
    (passed if cond else failed).append(name)
    print(("  PASS  " if cond else "  FAIL  ") + name + (f"   {detail}" if detail else ""))

print("=== 1. auth ===")
ftok, farmer = login("9000000001", "FARMER")
check("farmer logs in by phone/OTP", farmer["role"] == "FARMER", farmer["name"])
ttok, transporter = login("9000000002", "TRANSPORTER")
check("transporter logs in from the same build", transporter["role"] == "TRANSPORTER", transporter["name"])
ptok, _ = login("9000000005", "TRANSPORTER")  # KYC pending

print("\n=== 2. KYC gate ===")
avail = call("GET", "/trips/available", token=ptok, expect_ok=False)
check("unverified transporter is refused trips",
      avail["error"]["code"] == "KYC_PENDING_REVIEW", avail["error"]["code"])
online = call("PATCH", f"/vehicles/{'x'*24}/availability", {"status": "AVAILABLE"}, ptok, expect_ok=False)
check("bad vehicle id -> RESOURCE_NOT_FOUND", online["error"]["code"] == "RESOURCE_NOT_FOUND", online["error"]["code"])

print("\n=== 3. request + matching ===")
req = call("POST", "/transport/requests", {
    "cropType": "Onion", "quantityKg": 800,
    "pickup": {"name": "Pimpri, Pune", "lat": 18.5204, "lng": 73.8567},
    "destination": {"name": "Lasalgaon Mandi", "lat": 20.1417, "lng": 74.2389},
    "preferredDate": "2026-08-29T06:00:00.000Z",
}, ftok)["data"]
rid = req["_id"]
check("request created and matched", req["status"] == "MATCHED", req["status"])

matches = call("GET", f"/transport/requests/{rid}/matches", token=ftok)["data"]
check("at most 3 matches returned", 0 < len(matches) <= 3, f"{len(matches)} matches")
check("matches ranked by score", [m["score"] for m in matches] == sorted((m["score"] for m in matches), reverse=True))
check("only VERIFIED vehicles appear",
      {m["vehicle"]["verificationStatus"] for m in matches} == {"VERIFIED"})
check("transporter rating on each card", all(m["transporter"] and "ratingAvg" in m["transporter"] for m in matches))

best = matches[0]
for m in matches:
    print(f"    {m['transporter']['name']:16} score={m['score']:.2f} rating={m['transporter']['ratingAvg']}"
          f" total=Rs{m['totalCost']:.0f} you=Rs{m['farmerShare']:.0f} them=Rs{m['transporterShare']:.0f}")
check("60/40 split holds",
      abs(best["farmerShare"] - best["totalCost"] * 0.6) < 0.02 and
      abs(best["transporterShare"] - best["totalCost"] * 0.4) < 0.02)

print("\n=== 4. accept does NOT confirm the booking ===")
acc = call("POST", f"/transport/requests/{rid}/accept", {"vehicleId": best["vehicleId"]}, ftok)["data"]
check("request -> PAYMENT_PENDING", acc["request"]["status"] == "PAYMENT_PENDING", acc["request"]["status"])
check("payment row is CREATED, not PAID", acc["payment"]["status"] == "CREATED", acc["payment"]["status"])
check("farmer's share is what he pays", abs(acc["payment"]["amount"] - best["farmerShare"]) < 0.01)

print("\n=== 5. payment -> booking commit ===")
order = call("POST", "/payments/create-order", {"requestId": rid}, ftok)["data"]
check("order created in paise", order["amount"] == round(best["farmerShare"] * 100), order["amount"])

bad = call("POST", "/payments/verify", {
    "razorpay_order_id": order["razorpayOrderId"],
    "razorpay_payment_id": "pay_x", "razorpay_signature": "wrong",
}, ttok, expect_ok=False)
check("another user cannot verify my payment", bad["error"]["code"] == "AUTH_FORBIDDEN", bad["error"]["code"])

ver = call("POST", "/payments/verify", {
    "razorpay_order_id": order["razorpayOrderId"],
    "razorpay_payment_id": "pay_demo_1", "razorpay_signature": "demo",
}, ftok)["data"]
check("payment captured", ver["status"] == "PAID", ver["status"])

detail = call("GET", f"/transport/requests/{rid}", token=ftok)["data"]
check("booking confirmed only after capture", detail["request"]["status"] == "BOOKED", detail["request"]["status"])
check("vehicle assigned", detail["vehicle"] is not None)
check("capacity decremented",
      detail["vehicle"]["availableCapacityKg"] == detail["vehicle"]["capacityKg"] - 800,
      f"{detail['vehicle']['availableCapacityKg']}/{detail['vehicle']['capacityKg']}")

print("\n=== 6. trip lifecycle ===")
pod_first = call("PATCH", f"/transport/requests/{rid}/status", {"status": "DELIVERED"}, ttok, expect_ok=False)
check("cannot skip straight to DELIVERED",
      pod_first["error"]["code"] == "BOOKING_STATE_INVALID", pod_first["error"]["code"])

call("PATCH", f"/transport/requests/{rid}/status", {"status": "PICKED_UP"}, ttok)
no_pod = call("PATCH", f"/transport/requests/{rid}/status", {"status": "DELIVERED"}, ttok, expect_ok=False)
check("delivery without a photo -> POD_REQUIRED", no_pod["error"]["code"] == "POD_REQUIRED", no_pod["error"]["code"])

print("\n=== 7. cancellation policy ===")
after_pickup = call("POST", f"/transport/requests/{rid}/cancel", {"reason": "changed mind"}, ftok, expect_ok=False)
check("no automatic refund after pickup",
      after_pickup["error"]["code"] == "PAYMENT_REFUND_NOT_ALLOWED", after_pickup["error"]["code"])

print("\n=== 8. auth boundaries ===")
anon = call("GET", "/users/me", expect_ok=False)
check("no token -> AUTH_UNAUTHENTICATED", anon["error"]["code"] == "AUTH_UNAUTHENTICATED", anon["error"]["code"])
other = call("GET", f"/transport/requests/{rid}", token=ptok, expect_ok=False)
check("non-party cannot read a trip", other["error"]["code"] == "AUTH_FORBIDDEN", other["error"]["code"])
bad_body = call("POST", "/transport/requests", {"cropType": "Onion"}, ftok, expect_ok=False)
check("bad body -> VALIDATION_ERROR", bad_body["error"]["code"] == "VALIDATION_ERROR", bad_body["error"]["code"])
missing = call("GET", "/nope", expect_ok=False)
check("unknown route -> RESOURCE_NOT_FOUND", missing["error"]["code"] == "RESOURCE_NOT_FOUND", missing["error"]["code"])
check("every response carries a requestId", "requestId" in missing and missing["requestId"].startswith("req_"))

print("\n=== 9. webhook is signature-authenticated ===")
wh = urllib.request.Request(API + "/webhooks/razorpay", data=b'{"event":"payment.captured"}', method="POST")
wh.add_header("content-type", "application/json")
try:
    urllib.request.urlopen(wh)
    body = {"error": {"code": "NONE"}}
except urllib.error.HTTPError as e:
    body = json.load(e)
check("unsigned webhook rejected",
      body["error"]["code"] == "PAYMENT_SIGNATURE_INVALID", body["error"]["code"])

print(f"\n{len(passed)} passed, {len(failed)} failed")
if failed:
    print("FAILURES:", failed)
    raise SystemExit(1)
