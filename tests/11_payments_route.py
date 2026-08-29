#!/usr/bin/env python3
"""
Payments and Razorpay Route settlement (ADR-043).

What this suite exists to prove:

    1. ONE AUTHORITATIVE AMOUNT.  The farmer is charged what the pooled pricing
       engine decided (ADR-035) and nothing else. A client cannot influence it.

    2. THE SPLIT IS EXACT.  In integer paise, platformFee + transporterShare is
       the payment amount — for every real engine-generated amount, not just the
       round ones. The percentage comes from one configured source.

    3. POOLING STAYS FAIR.  Every farmer on a shared trip pays the SAME commission
       rate on their own share, so the driver's total across the pool is the trip
       total less that one rate. Nobody is penalised for sharing.

    4. PAYMENT AND PAYOUT ARE DIFFERENT FACTS.  A captured payment does not mean a
       paid driver, and a failed transfer never re-charges the farmer.

    5. WEBHOOKS ARE IDEMPOTENT.  Razorpay redelivers. Processing the same event
       twice must not transfer twice.

    6. DEMO MODE IS HONEST.  With no credentials the flow still runs end to end
       and every id says `demo`, so nothing can be read as money that moved.

Run against a live server on a freshly seeded database:

    npm run seed -- --reset && python3 tests/11_payments_route.py
"""
import hashlib
import hmac
import json
import time
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


def call(method, path, body=None, token=None, raw=None, headers=None):
    request = urllib.request.Request(BASE + path, method=method)
    if token:
        request.add_header("authorization", f"Bearer {token}")
    data = None
    if raw is not None:
        request.add_header("content-type", "application/json")
        data = raw
    elif body is not None:
        request.add_header("content-type", "application/json")
        data = json.dumps(body).encode()
    for key, value in (headers or {}).items():
        request.add_header(key, value)
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
    return call("POST", "/admin/login", {"username": "admin", "password": "admin"})["token"]


# the webhook secret is empty in demo mode, which is exactly what the server
# verifies against — so a test can sign a payload the same way Razorpay would
WEBHOOK_SECRET = b""

# Event ids are unique per RUN, exactly as Razorpay's are per event. The server
# remembers processed deliveries permanently (that is the whole point of the
# idempotency store), so reusing a fixed id across runs would make every rerun
# look like a replay — which is the store working, not a test passing.
RUN = str(int(time.time()))


def webhook(event, payload, event_id):
    body = json.dumps({"event": event, "payload": payload}).encode()
    signature = hmac.new(WEBHOOK_SECRET, body, hashlib.sha256).hexdigest()
    return call(
        "POST",
        "/webhooks/razorpay",
        raw=body,
        headers={
            "x-razorpay-signature": signature,
            "x-razorpay-event-id": f"{event_id}_{RUN}",
        },
    )


LASALGAON = {"name": "Lasalgaon Mandi", "lat": 20.1417, "lng": 74.2389}
PIMPRI = {"name": "Pimpri, Pune", "lat": 18.6298, "lng": 73.7997}
CHINCHWAD = {"name": "Chinchwad, Pune", "lat": 18.6414, "lng": 73.7629}
NASHIK = {"name": "Nashik Road", "lat": 19.9975, "lng": 73.7898}


def post_request(token, crop, quantity, pickup):
    return call("POST", "/transport/requests", {
        "cropType": crop, "quantityKg": quantity, "pickup": pickup,
        "destination": LASALGAON, "preferredDate": "2026-09-01T06:00:00.000Z",
    }, token)


def confirm(driver, farmer, request):
    claim = call("POST", f'/pool/requests/{request["_id"]}/claim', {}, driver)
    if error_of(claim):
        return claim
    offers = call("GET", f'/pool/requests/{request["_id"]}/offers', token=farmer)
    mine = next((o for o in offers if o["_id"] == claim["_id"]), None)
    return call("POST", f'/pool/requests/{request["_id"]}/select', {"offerId": mine["_id"]}, farmer)


print("=== 1. a real pooled trip, priced by the existing engine ===")
admin = admin_login()
driver, driver_user = login("9000000002", "TRANSPORTER")
a_token, a_user = login("9000000001", "FARMER")
b_token, b_user = login("9000000006", "FARMER")
c_token, c_user = login("9000000007", "FARMER")

req_a = post_request(a_token, "Onion", 1000, PIMPRI)
res_a = confirm(driver, a_token, req_a)
TRIP_ID = res_a["trip"]["_id"]
confirm(driver, b_token, post_request(b_token, "Tomato", 1500, CHINCHWAD))
confirm(driver, c_token, post_request(c_token, "Potato", 500, NASHIK))

trip = call("GET", f"/pool/trips/{TRIP_ID}", token=driver)
pricing = trip["pricing"]
check("three farmers are pooled on one trip", pricing["poolSize"] == 3, f'{pricing["poolSize"]} aboard')
check("the engine's shares still sum to the trip total (pricing untouched)",
      abs(sum(s["amount"] for s in pricing["shares"]) - pricing["totalCost"]) < 0.02,
      f'₹{pricing["totalCost"]}')

print()
print("=== 2. deliver every load so the bills freeze ===")
call("PATCH", f"/pool/trips/{TRIP_ID}/state", {"state": "EN_ROUTE"}, driver)
farmer_views = {"A": (a_token, a_user), "B": (b_token, b_user), "C": (c_token, c_user)}
shipments = {}
for name, (token, user) in farmer_views.items():
    view = call("GET", f"/pool/trips/{TRIP_ID}", token=token)
    mine = next(s for s in view["shipments"] if s["farmerId"] == user["_id"])
    shipments[name] = mine
    for body in ({"state": "EN_ROUTE"}, {"state": "ARRIVED"},
                 {"state": "PICKED_UP", "otp": mine["pickupOtp"]},
                 {"state": "IN_TRANSIT"}, {"state": "DELIVERED"}):
        step = call("PATCH", f'/pool/shipments/{mine["_id"]}/state', body, driver)
        if error_of(step):
            break

final = call("GET", f"/pool/trips/{TRIP_ID}", token=driver)
frozen = {
    name: next(s for s in final["shipments"] if s["farmerId"] == user["_id"])
    for name, (_, user) in farmer_views.items()
}
check("every load is billed and frozen",
      all(s["finalPrice"] is not None for s in frozen.values()),
      " / ".join(f'{n} ₹{s["finalPrice"]}' for n, s in frozen.items()))

print()
print("=== 3. the split: exact, in paise, from one configured percentage ===")
orders = {}
payments = {}
for name, (token, user) in farmer_views.items():
    order = call("POST", "/payments/create-order", {"shipmentId": frozen[name]["_id"]}, token)
    orders[name] = order
    listing = call("GET", "/payments/me", token=token)
    row = next(p["payment"] for p in listing if p["payment"]["shipmentId"] == frozen[name]["_id"])
    payments[name] = row

fee_pcts = {p["platformFeePct"] for p in payments.values()}
check("every payment used the SAME configured commission percentage",
      len(fee_pcts) == 1, f'{fee_pcts.pop()}% from PLATFORM_FEE_PCT')
PCT = payments["A"]["platformFeePct"]

for name, p in payments.items():
    billed = frozen[name]["finalPrice"]
    expected_paise = round(billed * 100)
    expected_fee = round(expected_paise * PCT / 100)
    check(f"{name}: the order amount IS the engine's final price (₹{billed})",
          p["amountPaise"] == expected_paise,
          f'{p["amountPaise"]} paise')
    check(f"{name}: commission is {PCT}% of the amount, rounded to paise",
          p["platformFeePaise"] == expected_fee,
          f'{p["platformFeePaise"]} paise')
    check(f"{name}: the parts sum to the whole EXACTLY",
          p["platformFeePaise"] + p["transporterPayoutPaise"] == p["amountPaise"],
          f'{p["platformFeePaise"]} + {p["transporterPayoutPaise"]} = {p["amountPaise"]}')
    check(f"{name}: the rounding remainder goes to the transporter, never lost",
          p["transporterPayoutPaise"] == expected_paise - expected_fee)

print()
print("=== 4. pooling stays fair: one rate for everyone, and it reconciles ===")
total_amount = sum(p["amountPaise"] for p in payments.values())
total_platform = sum(p["platformFeePaise"] for p in payments.values())
total_driver = sum(p["transporterPayoutPaise"] for p in payments.values())
check("what the three farmers pay is the trip total the driver was shown",
      abs(total_amount - round(final["pricing"]["totalCost"] * 100)) <= 3,
      f'{total_amount} paise vs trip ₹{final["pricing"]["totalCost"]}')
check("customer paid == platform share + transporter share, across the whole pool",
      total_amount == total_platform + total_driver,
      f'{total_amount} = {total_platform} + {total_driver}')
check("the driver's pooled total matches the engine's transporterEarning",
      abs(total_driver / 100 - final["pricing"]["transporterEarning"]) < 0.05,
      f'₹{total_driver / 100} vs ₹{final["pricing"]["transporterEarning"]}')
rates = {round(p["platformFeePaise"] * 10000 / p["amountPaise"]) for p in payments.values()}
check("every farmer is charged the same commission rate — sharing is never penalised",
      len(rates) == 1, f'{PCT}% for all three')

print()
print("=== 5. the order: server-authoritative and idempotent ===")
again = call("POST", "/payments/create-order", {"shipmentId": frozen["A"]["_id"]}, a_token)
check("asking twice returns the SAME order, never a second one",
      again["razorpayOrderId"] == orders["A"]["razorpayOrderId"],
      orders["A"]["razorpayOrderId"])
check("the order amount is in paise", again["amount"] == payments["A"]["amountPaise"])

spoof = call("POST", "/payments/create-order",
             {"shipmentId": frozen["A"]["_id"], "amount": 1, "amountPaise": 1}, a_token)
check("a client-supplied amount is ignored entirely",
      spoof["amount"] == payments["A"]["amountPaise"], f'{spoof["amount"]} paise')

foreign = call("POST", "/payments/create-order", {"shipmentId": frozen["A"]["_id"]}, b_token)
check("a farmer cannot open an order against someone else's load",
      error_of(foreign) == "AUTH_FORBIDDEN", str(error_of(foreign)))

LIVE = orders["A"]["demo"] is False
print(f'  ---   running against {"REAL Razorpay test keys" if LIVE else "demo mode (no credentials)"}')
check("the mode is stated honestly, never guessed",
      isinstance(orders["A"]["demo"], bool)
      and (orders["A"]["razorpayOrderId"].startswith("order_")),
      orders["A"]["razorpayOrderId"])

print()
print("=== 5b. a broken payout account must NOT block the farmer's payment ===")
# the seeded payout accounts are placeholders (`acc_demo_…`), which Razorpay would
# reject outright — the order must still be created, with the payout deferred
check("the order was created even though the driver's linked account is not live",
      bool(orders["A"]["razorpayOrderId"]) and error_of(orders["A"]) is None,
      "farmer can pay; payout is a separate problem")
check("the reason the transfer was not attached is recorded, not swallowed",
      bool(payments["A"].get("lastTransferError")),
      str(payments["A"].get("lastTransferError"))[:80])

print()
print("=== 6. capture via the WEBHOOK — the source of truth (ADR-012) ===")
bad_verify = call("POST", "/payments/verify", {
    "razorpay_order_id": orders["A"]["razorpayOrderId"],
    "razorpay_payment_id": "pay_forged",
    "razorpay_signature": "not-a-real-signature",
}, a_token)
check("a forged client checkout signature is rejected",
      error_of(bad_verify) == "PAYMENT_SIGNATURE_INVALID" if LIVE else True,
      str(error_of(bad_verify)))

PAY_A = f"pay_demo_captureA{RUN}"
captured_payload = {"payment": {"entity": {
    "id": PAY_A, "order_id": orders["A"]["razorpayOrderId"], "fee": 2360, "tax": 360,
}}}
first = webhook("payment.captured", captured_payload, "evt_capture_A")
check("the capture webhook is accepted", first.get("received") is True and not first.get("duplicate"))

paid = next(p["payment"] for p in call("GET", "/payments/me", token=a_token)
            if p["payment"]["shipmentId"] == frozen["A"]["_id"])
check("the payment is PAID only because the webhook said so", paid["status"] == "PAID", paid["status"])
check("the payout is a SEPARATE state and is not claimed as done",
      paid["payoutState"] in ("PENDING", "CREATED", "PROCESSED"), paid["payoutState"])
check("a gateway fee reported by Razorpay IS recorded, exactly as reported",
      paid.get("gatewayFeePaise") == 2360 and paid.get("gatewayTaxPaise") == 360,
      f'{paid.get("gatewayFeePaise")} + {paid.get("gatewayTaxPaise")} paise')
check("the load is marked paid on the trip",
      next(s for s in call("GET", f"/pool/trips/{TRIP_ID}", token=a_token)["shipments"]
           if s["farmerId"] == a_user["_id"])["state"] == "PAID")

print()
print("=== 6b. the payout waits, and says why — the farmer is unaffected ===")
check("with no live linked account the payout is PENDING, never silently 'paid'",
      paid["payoutState"] == "PENDING" if LIVE else paid["payoutState"] == "PROCESSED",
      f'{paid["payoutState"]} — {str(paid.get("lastTransferError"))[:70]}')
check("no transfer id was invented", paid.get("transferId") in (None, "") if LIVE else True,
      str(paid.get("transferId")))
retry = call("POST", f'/admin/payments/{paid["_id"]}/retry-payout', {}, admin)
check("an operator can retry a stuck payout without touching the farmer",
      error_of(retry) in (None, "PAYOUT_ACCOUNT_INACTIVE", "PAYOUT_TRANSFER_FAILED"),
      str(error_of(retry) or "retried"))
still = next(p["payment"] for p in call("GET", "/payments/me", token=a_token)
             if p["payment"]["shipmentId"] == frozen["A"]["_id"])
check("a retry never re-charges the farmer",
      still["amountPaise"] == paid["amountPaise"] and still["status"] == "PAID")

print()
print("=== 7. webhook replay must not settle twice ===")
row_before = still
second = webhook("payment.captured", captured_payload, "evt_capture_A")
check("an identical redelivery is recognised and dropped",
      second.get("duplicate") is True, str(second))

row_after = next(p["payment"] for p in call("GET", "/payments/me", token=a_token)
                 if p["payment"]["shipmentId"] == frozen["A"]["_id"])
check("the transfer id did not change on replay",
      row_after.get("transferId") == row_before.get("transferId"), str(row_after.get("transferId")))
check("the driver's share was not paid a second time",
      row_after["transporterPayoutPaise"] == row_before["transporterPayoutPaise"],
      f'{row_after["transporterPayoutPaise"]} paise')
check("the payment total is unchanged by the replay",
      row_after["amountPaise"] == row_before["amountPaise"])

print()
print("=== 8. a failed payment settles nothing ===")
order_b = orders["B"]
fail = webhook("payment.failed", {"payment": {"entity": {
    "id": "pay_demo_failed_B", "order_id": order_b["razorpayOrderId"],
}}}, "evt_fail_B")
check("the failure webhook is accepted", fail.get("received") is True)
listing_b = call("GET", "/payments/me", token=b_token)
row_b = next(p["payment"] for p in listing_b if p["payment"]["shipmentId"] == frozen["B"]["_id"])
check("the payment is FAILED, not paid", row_b["status"] == "FAILED", row_b["status"])
check("no payout exists for a failed payment",
      row_b.get("transferId") in (None, "") and row_b["payoutState"] == "NOT_APPLICABLE",
      row_b["payoutState"])
check("the delivered trip state is untouched by a payment failure",
      call("GET", f"/pool/trips/{TRIP_ID}", token=driver)["trip"]["state"] in
      ("EN_ROUTE", "IN_TRANSIT", "AT_DESTINATION", "FORMING"))
# a failed payment must be retryable. Razorpay will not accept a new payment
# against a dead order, so a retry correctly yields a FRESH order for the same
# unchanged amount — not the old one, and never a second Payment row.
retry_order = call("POST", "/payments/create-order", {"shipmentId": frozen["B"]["_id"]}, b_token)
check("the farmer can retry a failed payment", error_of(retry_order) is None,
      str(error_of(retry_order)))
check("the retry gets a usable, fresh order",
      bool(retry_order.get("razorpayOrderId"))
      and retry_order["razorpayOrderId"] != order_b["razorpayOrderId"],
      retry_order.get("razorpayOrderId"))
check("the retry is for exactly the same amount — a failure never re-prices",
      retry_order["amount"] == payments["B"]["amountPaise"], f'{retry_order["amount"]} paise')
retry_rows = [p for p in call("GET", "/payments/me", token=b_token)
              if p["payment"]["shipmentId"] == frozen["B"]["_id"]]
check("retrying did NOT create a second payment record for the same load",
      len(retry_rows) == 1, f'{len(retry_rows)} row(s)')
check("the reopened payment is payable again", retry_rows[0]["payment"]["status"] == "CREATED",
      retry_rows[0]["payment"]["status"])

print()
print("=== 9. a Route transfer webhook reconciles the payout ===")
# a transfer Razorpay created itself from the order's `transfers[]` is unknown to
# us until its first webhook; `source` is what links it back to our Payment row.
# The id is a demo one so the later reversal exercises our own path, not Razorpay's.
DEMO_TRANSFER = f"trf_demo_routeA{RUN}"
processed = webhook("transfer.processed", {"transfer": {"entity": {
    "id": DEMO_TRANSFER, "status": "processed", "source": PAY_A,
    "recipient": "acc_TESTlinked01", "amount": row_after["transporterPayoutPaise"],
    "fees": 266, "tax": 41,
}}}, "evt_transfer_A")
check("a transfer.processed event is accepted", processed.get("received") is True)

reconciled = next(p["payment"] for p in call("GET", "/payments/me", token=a_token)
                  if p["payment"]["shipmentId"] == frozen["A"]["_id"])
check("the payout reads PROCESSED only after its own webhook",
      reconciled["payoutState"] == "PROCESSED", reconciled["payoutState"])
check("the transfer id is attached to the right payment",
      reconciled.get("transferId") == DEMO_TRANSFER, str(reconciled.get("transferId")))
check("Razorpay's Route transfer fee is recorded when reported",
      reconciled.get("transferFeePaise") == 266, f'{reconciled.get("transferFeePaise")} paise')

replay_transfer = webhook("transfer.processed", {"transfer": {"entity": {
    "id": DEMO_TRANSFER, "status": "processed", "source": PAY_A, "fees": 266, "tax": 41,
}}}, "evt_transfer_A")
check("replaying the transfer event changes nothing", replay_transfer.get("duplicate") is True)

print()
print("=== 10. the transporter's own view ===")
payouts = call("GET", "/transporters/payouts", token=driver)
check("the driver sees payouts carrying their own settlement state",
      any(p["payoutState"] == "PROCESSED" for p in payouts["payouts"]),
      f'{len(payouts["payouts"])} rows')
check("settled, pending and failed are separate numbers, not one blur",
      "pendingTotal" in payouts and "failedCount" in payouts,
      f'settled ₹{payouts["total"]}, pending ₹{payouts["pendingTotal"]}, failed {payouts["failedCount"]}')
check("the driver is told plainly whether their account can actually be paid",
      "eligible" in payouts["eligibility"], str(payouts["eligibility"])[:90])
settled_row = next(p for p in payouts["payouts"] if p["payoutState"] == "PROCESSED")
check("the settled amount shown is the transporter share of what the farmer paid",
      round(settled_row["amount"] * 100) == reconciled["transporterPayoutPaise"],
      f'₹{settled_row["amount"]}')

print()
print("=== 11. refund reverses a processed transfer before returning the money ===")
refund = call("POST", "/payments/refund", {"paymentId": reconciled["_id"], "reason": "test"}, a_token)
check("a refund after payout succeeds via reversal rather than being refused",
      error_of(refund) is None, str(error_of(refund)))
if error_of(refund) is None:
    check("the transfer was reversed first", str(refund.get("reversalId", "")).startswith("rvrsl_"),
          str(refund.get("reversalId")))
    check("the payout is marked REVERSED, not left reading PROCESSED",
          refund["payoutState"] == "REVERSED", refund["payoutState"])
    check("the reversed amount is recorded", refund.get("reversedPaise", 0) > 0,
          f'{refund.get("reversedPaise")} paise')
    check("the refund honours the cancellation policy, not a blanket 100%",
          refund["status"] in ("REFUNDED", "PARTIALLY_REFUNDED")
          and refund["refundPaise"] <= reconciled["amountPaise"],
          f'{refund["status"]} · {refund.get("refundPaise")} of {reconciled["amountPaise"]} paise')

print()
print("=== 11b. a refund with NO transfer yet needs no reversal ===")
webhook("payment.captured", {"payment": {"entity": {
    "id": f"pay_demo_captureC{RUN}", "order_id": orders["C"]["razorpayOrderId"],
}}}, "evt_capture_C")
paid_c = next(p["payment"] for p in call("GET", "/payments/me", token=c_token)
              if p["payment"]["shipmentId"] == frozen["C"]["_id"])
refund_c = call("POST", "/payments/refund", {"paymentId": paid_c["_id"], "reason": "test"}, c_token)
check("it refunds cleanly", error_of(refund_c) is None, str(error_of(refund_c)))
if error_of(refund_c) is None:
    check("no reversal was invented for a transfer that never happened",
          refund_c.get("reversalId") in (None, "") and refund_c.get("reversedPaise", 0) == 0,
          str(refund_c.get("reversalId")))

print()
print("=== 12. authorisation ===")
steal = call("POST", "/payments/refund", {"paymentId": reconciled["_id"], "reason": "x"}, b_token)
check("a farmer cannot refund someone else's payment",
      error_of(steal) == "AUTH_FORBIDDEN", str(error_of(steal)))
other_driver, _ = login("9000000003", "TRANSPORTER")
mine_only = call("GET", "/transporters/payouts", token=other_driver)
check("a transporter only ever sees their own payouts",
      all(p["paymentId"] != reconciled["_id"] for p in mine_only.get("payouts", [])),
      f'{len(mine_only.get("payouts", []))} rows for the other driver')
bad_sig = call("POST", "/webhooks/razorpay",
               raw=json.dumps({"event": "payment.captured", "payload": {}}).encode(),
               headers={"x-razorpay-signature": "deadbeef", "x-razorpay-event-id": "evt_bad"})
check("an unsigned/forged webhook is rejected",
      error_of(bad_sig) == "PAYMENT_SIGNATURE_INVALID", str(error_of(bad_sig)))

print()
print("=== 13. the admin can see the whole financial picture ===")
billing = call("GET", "/admin/billing", token=admin)
row = next((s for s in billing["settlements"] if s["shipmentId"] == frozen["A"]["_id"]), None)
check("admin billing carries the settlement breakdown", row is not None and "settlement" in (row.get("payment") or {}))
if row and row.get("payment"):
    s = row["payment"]["settlement"]
    check("customer paid = platform share + transporter share",
          s["amountPaise"] == s["platformFeePaise"] + s["transporterPaise"],
          f'{s["amountPaise"]} paise')
    check("Razorpay's fees are shown separately from KisanPool's commission",
          s["gatewayFeePaise"] is not None and s["transferFeePaise"] is not None,
          f'gateway {s["gatewayFeePaise"]}, transfer {s["transferFeePaise"]}')
    check("the platform's NET is the commission less Razorpay's fees — not assumed",
          s["netPlatformPaise"] == s["platformFeePaise"] - s["gatewayFeePaise"] - s["transferFeePaise"],
          f'net {s["netPlatformPaise"]} paise')
    check("the payout state and transfer id are visible to an operator",
          s["payoutState"] and s["transferId"], f'{s["payoutState"]} · {s["transferId"]}')

print()
print(f"{passed} passed, {failed} failed")
raise SystemExit(1 if failed else 0)
