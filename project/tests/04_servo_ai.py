import json, urllib.request, urllib.error
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
    return out["accessToken"]

passed, failed = [], []
def check(name, cond, detail=""):
    (passed if cond else failed).append(name)
    print(("  PASS  " if cond else "  FAIL  ") + name + (f"   {detail}" if detail else ""))

tok = login("9000000031", "FARMER")
call("PATCH", "/users/me", {"name": "Voice Tester",
     "defaultLocation": {"name": "Pimpri, Pune", "lat": 18.5204, "lng": 73.8567}}, tok)

def chat(msg, session="s1"):
    """A domain error here is a normal conversational outcome — the voice sheet
    speaks error.message. Return it in the same shape so the test can read it."""
    out = call("POST", "/ai/chat", {"message": msg, "sessionId": session, "language": "en"},
               tok, expect_ok=False)
    if out.get("success"):
        return out["data"]
    return {"reply": out["error"]["message"], "code": out["error"]["code"]}

print("=== ambiguity is a question, never a guess ===")
r = chat("hello")
check("vague input gets a follow-up question, no tool run",
      r["reply"] and r.get("action") is None and r.get("data") is None, r["reply"][:60])

print("\n=== read-only tools run without confirmation ===")
r = chat("where is my truck")
check("status question gets a human answer, never a fabricated trip",
      bool(r["reply"]) and "no trips" in r["reply"].lower(), r["reply"][:70])

print("\n=== state-changing tools require a spoken yes ===")
r = chat("send 500 kg onion to Lasalgaon", "s2")
pending = r.get("pendingConfirmation")
check("a create is staged, not executed", bool(pending), pending["tool"] if pending else "no confirmation asked")
check("the assistant says what it will do first",
      bool(pending) and "go ahead" in r["reply"].lower(), r["reply"][:70])

before = len(call("GET", "/transport/requests", token=tok)["data"])
r = chat("no", "s2")
after = len(call("GET", "/transport/requests", token=tok)["data"])
check("saying no performs nothing", after == before, f"{before} -> {after} requests")

r = chat("send 500 kg onion to Lasalgaon", "s3")
r = chat("yes", "s3")
final = call("GET", "/transport/requests", token=tok)["data"]
check("saying yes runs the tool", len(final) == before + 1, f"{before} -> {len(final)} requests")
check("the assistant navigates rather than acting further",
      r.get("action", {}).get("type") == "NAVIGATE", str(r.get("action")))
check("the created request is a real DB record with a server-set status",
      final[0]["status"] in ("SEARCHING", "MATCHED"), final[0]["status"])
check("only what was spoken was used — nothing invented",
      final[0]["quantityKg"] == 500 and final[0]["cropType"] == "Onion"
      and final[0]["destination"]["name"] == "Lasalgaon Mandi",
      f"{final[0]['quantityKg']}kg {final[0]['cropType']} to {final[0]['destination']['name']}")

print("\n=== a half-stated request is questioned, not filled in ===")
r_partial = chat("send some onions", "s5")
check("missing quantity and mandi are asked for, no tool staged",
      r_partial.get("pendingConfirmation") is None and "tell me" in r_partial["reply"].lower(),
      r_partial["reply"][:70])

print("\n=== the assistant never pays ===")
rid = final[0]["_id"]
matches = call("GET", f"/transport/requests/{rid}/matches", token=tok)["data"]
if matches:
    staged = chat("accept the best vehicle", "s4")
    check("the price and transporter are stated before accepting",
          staged.get("pendingConfirmation") is not None and "\u20b9" in staged["reply"],
          staged["reply"][:80])
    r = chat("yes", "s4")
    route = (r.get("action") or {}).get("route", "")
    check("acceptMatch hands off to checkout", "checkout" in route, route or r["reply"][:60])
    pay = call("GET", "/payments/me", token=tok)["data"]
    unpaid = [p for p in pay if p["payment"]["status"] == "CREATED"]
    check("no payment was captured by voice", all(p["payment"]["status"] != "PAID" for p in pay),
          f"{len(unpaid)} awaiting payment on the checkout screen")
else:
    check("acceptMatch hands off to checkout", False, "no matches to accept")

print("\n=== identity comes from the JWT, never the transcript ===")
other = login("9000000032", "FARMER")
r2 = call("POST", "/ai/chat", {"message": f"cancel request {rid}", "sessionId": "s9", "language": "en"}, other)["data"]
still = call("GET", f"/transport/requests/{rid}", token=tok)["data"]["request"]["status"]
check("another user's voice cannot touch my request", still != "CANCELLED", still)

print("\n=== Sarvam is proxied, and its absence degrades honestly ===")
tts = call("POST", "/ai/tts", {"text": "hello", "language": "en"}, tok, expect_ok=False)
check("no Sarvam key -> AI_TOOL_ERROR, not a fabricated reply",
      tts["error"]["code"] == "AI_TOOL_ERROR", tts["error"]["code"])

print(f"\n{len(passed)} passed, {len(failed)} failed")
if failed:
    print("FAILURES:", failed); raise SystemExit(1)
