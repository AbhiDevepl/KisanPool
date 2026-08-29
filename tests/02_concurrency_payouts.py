import json, threading, urllib.request, urllib.error

API = "http://localhost:4000"

def call(method, path, body=None, token=None, expect_ok=True):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method)
    if body is not None: req.add_header("content-type", "application/json")
    if token: req.add_header("authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req) as res: payload = json.load(res)
    except urllib.error.HTTPError as e: payload = json.load(e)
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

PICKUP = {"name": "Pimpri, Pune", "lat": 18.5204, "lng": 73.8567}
DEST = {"name": "Lasalgaon Mandi", "lat": 20.1417, "lng": 74.2389}

def make_request(token, qty):
    return call("POST", "/transport/requests", {
        "cropType": "Onion", "quantityKg": qty, "pickup": PICKUP,
        "destination": DEST, "preferredDate": "2026-08-29T06:00:00.000Z"}, token)["data"]

print("=== A. two concurrent accept-and-pay on the same vehicle ===")
# 2600kg only fits the 4000kg vehicle, so both farmers are forced onto the same one
a_tok, _ = login("9000000011", "FARMER")
b_tok, _ = login("9000000012", "FARMER")
ra, rb = make_request(a_tok, 2600), make_request(b_tok, 2600)

ma = call("GET", f"/transport/requests/{ra['_id']}/matches", token=a_tok)["data"]
mb = call("GET", f"/transport/requests/{rb['_id']}/matches", token=b_tok)["data"]
cap_before = ma[0]["vehicle"]["availableCapacityKg"]
check("both farmers matched to the same single vehicle",
      len(ma) == 1 and len(mb) == 1 and ma[0]["vehicleId"] == mb[0]["vehicleId"],
      f"{len(ma)} / {len(mb)} matches")
vid = ma[0]["vehicleId"]

call("POST", f"/transport/requests/{ra['_id']}/accept", {"vehicleId": vid}, a_tok)
call("POST", f"/transport/requests/{rb['_id']}/accept", {"vehicleId": vid}, b_tok)
oa = call("POST", "/payments/create-order", {"requestId": ra["_id"]}, a_tok)["data"]
ob = call("POST", "/payments/create-order", {"requestId": rb["_id"]}, b_tok)["data"]

results = {}
def pay(tag, order, token):
    results[tag] = call("POST", "/payments/verify", {
        "razorpay_order_id": order["razorpayOrderId"],
        "razorpay_payment_id": f"pay_demo_{tag}",
        "razorpay_signature": "demo"}, token, expect_ok=False)

# fire both at the same instant
threads = [threading.Thread(target=pay, args=("A", oa, a_tok)),
           threading.Thread(target=pay, args=("B", ob, b_tok))]
barrier = threading.Barrier(2)
for t in threads: t.start()
for t in threads: t.join()

sa = call("GET", f"/transport/requests/{ra['_id']}", token=a_tok)["data"]["request"]["status"]
sb = call("GET", f"/transport/requests/{rb['_id']}", token=b_tok)["data"]["request"]["status"]
booked = [s for s in (sa, sb) if s == "BOOKED"]
print(f"    A -> {sa}    B -> {sb}")
check("exactly one of the two ends up BOOKED", len(booked) == 1, f"{sa} / {sb}")

loser_tag = "A" if sa != "BOOKED" else "B"
loser = results[loser_tag]
check("the loser is told the vehicle was taken",
      not loser.get("success") and loser["error"]["code"] == "CONCURRENT_BOOKING",
      loser.get("error", {}).get("code", "success"))

pays = call("GET", "/payments/me", token=a_tok if loser_tag == "A" else b_tok)["data"]
refunded = [p["payment"] for p in pays if p["payment"]["status"] in ("REFUNDED", "PARTIALLY_REFUNDED")]
check("the loser is refunded automatically", len(refunded) >= 1,
      refunded[0]["status"] if refunded else "no refund")
check("the refund is the full amount (not the cancellation fee)",
      bool(refunded) and abs(refunded[0]["refundAmount"] - refunded[0]["amount"]) < 0.01,
      f"Rs{refunded[0]['refundAmount']} of Rs{refunded[0]['amount']}" if refunded else "")

veh = call("GET", "/vehicles/me", token=login("9000000002", "TRANSPORTER")[0])["data"]
check("capacity decremented exactly once (not twice)",
      veh["availableCapacityKg"] == cap_before - 2600,
      f"{cap_before} -> {veh['availableCapacityKg']} (one 2600kg booking)")

print("\n=== B. cancellation before pickup is refunded minus the fee ===")
c_tok, _ = login("9000000013", "FARMER")
rc = make_request(c_tok, 1000)
mc = call("GET", f"/transport/requests/{rc['_id']}/matches", token=c_tok)["data"]
call("POST", f"/transport/requests/{rc['_id']}/accept", {"vehicleId": mc[0]["vehicleId"]}, c_tok)
oc = call("POST", "/payments/create-order", {"requestId": rc["_id"]}, c_tok)["data"]
call("POST", "/payments/verify", {"razorpay_order_id": oc["razorpayOrderId"],
     "razorpay_payment_id": "pay_demo_C", "razorpay_signature": "demo"}, c_tok)

cancelled = call("POST", f"/transport/requests/{rc['_id']}/cancel", {"reason": "Rain"}, c_tok)["data"]
check("request cancelled", cancelled["request"]["status"] == "CANCELLED", cancelled["request"]["status"])
paid, refund = mc[0]["farmerShare"], cancelled["refund"]
expected = round(paid * 0.95, 2)
check("refund is 95% — the 5% fee from config",
      refund and abs(refund["refundAmount"] - expected) < 0.5,
      f"Rs{refund['refundAmount']:.0f} of Rs{paid:.0f} (expected Rs{expected:.0f})")

print("\n=== C. delivery -> payout -> ratings ===")
d_tok, farmer_d = login("9000000014", "FARMER")
t_tok, transporter = login("9000000003", "TRANSPORTER")   # Sunil Kadam, 2500kg
rd = make_request(d_tok, 700)
md = [m for m in call("GET", f"/transport/requests/{rd['_id']}/matches", token=d_tok)["data"]
      if m["transporter"]["name"] == "Sunil Kadam"]
check("chosen transporter is offered the trip", len(md) == 1)
call("POST", f"/transport/requests/{rd['_id']}/accept", {"vehicleId": md[0]["vehicleId"]}, d_tok)
od = call("POST", "/payments/create-order", {"requestId": rd["_id"]}, d_tok)["data"]
call("POST", "/payments/verify", {"razorpay_order_id": od["razorpayOrderId"],
     "razorpay_payment_id": "pay_demo_D", "razorpay_signature": "demo"}, d_tok)

avail = call("GET", "/trips/available", token=t_tok)["data"]
check("verified transporter sees trips", isinstance(avail, list))

call("PATCH", f"/transport/requests/{rd['_id']}/status", {"status": "PICKED_UP"}, t_tok)
# POD via multipart
boundary = "----kp"
body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"pod.jpg\"\r\n"
        f"Content-Type: image/jpeg\r\n\r\n").encode() + b"\xff\xd8\xff\xe0fake-jpeg" + f"\r\n--{boundary}--\r\n".encode()
req = urllib.request.Request(f"{API}/transport/requests/{rd['_id']}/pod", data=body, method="POST")
req.add_header("content-type", f"multipart/form-data; boundary={boundary}")
req.add_header("authorization", "Bearer " + t_tok)
with urllib.request.urlopen(req) as res: pod = json.load(res)
check("proof-of-delivery photo stored as a URL",
      pod["success"] and pod["data"]["podUrl"].startswith("/uploads/"), pod["data"].get("podUrl"))

delivered = call("PATCH", f"/transport/requests/{rd['_id']}/status", {"status": "DELIVERED"}, t_tok)["data"]
check("trip delivered", delivered["status"] == "DELIVERED", delivered["status"])

payouts = call("GET", "/transporters/payouts", token=t_tok)["data"]
this_payout = [p for p in payouts["payouts"] if p["requestId"] == rd["_id"]]
check("payout created automatically on delivery",
      bool(this_payout) and this_payout[0]["transferId"] is not None,
      this_payout[0]["transferStatus"] if this_payout else "none")
check("payout is the transporter share minus the platform fee",
      bool(this_payout) and abs(this_payout[0]["amount"] - md[0]["transporterShare"] * 0.9) < 1,
      f"Rs{this_payout[0]['amount']:.0f} of Rs{md[0]['transporterShare']:.0f}" if this_payout else "")
check("running total includes it", payouts["total"] >= this_payout[0]["amount"] if this_payout else False)

seeded_count = md[0]["transporter"]["ratingCount"]
call("POST", f"/trips/{rd['_id']}/ratings", {"stars": 5, "comment": "On time"}, d_tok)
again = call("POST", f"/trips/{rd['_id']}/ratings", {"stars": 4}, d_tok, expect_ok=False)
check("a second rating from the same user is refused",
      again["error"]["code"] == "BOOKING_ALREADY_RATED", again["error"]["code"])
call("POST", f"/trips/{rd['_id']}/ratings", {"stars": 5, "comment": "Load was ready"}, t_tok)

e_tok, _ = login("9000000015", "FARMER")
re_ = make_request(e_tok, 700)
me = [m for m in call("GET", f"/transport/requests/{re_['_id']}/matches", token=e_tok)["data"]
      if m["transporter"]["name"] == "Sunil Kadam"]
check("the new rating shows on the next match card",
      bool(me) and me[0]["transporter"]["ratingCount"] == seeded_count + 1,
      f"{seeded_count} -> {me[0]['transporter']['ratingCount']} reviews, avg now {me[0]['transporter']['ratingAvg']}" if me else "")

print(f"\n{len(passed)} passed, {len(failed)} failed")
if failed:
    print("FAILURES:", failed)
    raise SystemExit(1)
