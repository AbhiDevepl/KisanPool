# KisanPool

Shared produce transport for Indian farmers. A farmer's request is matched to a nearby
verified vehicle with spare capacity, the trip cost is split 60/40, the farmer pays their
share through Razorpay, the trip is tracked live on a map, and the transporter is paid out
automatically on delivery. A farmer can do the whole thing by voice in their own language
through **Servo AI** (Sarvam).

One Expo app with two roles, one Express + Socket.io backend, MongoDB.

> **The Golden Rule:** AI understands → Backend decides → Matching engine calculates →
> Payment settles it → Database records everything → Frontend presents.

Planning documents live in [`docs/`](docs/) and are the source of truth:
[PRD](docs/PRD.md) · [Architecture](docs/ARCHITECTURE.md) · [Data model](docs/DATA_MODEL.md) ·
[API contracts](docs/API_CONTRACTS.md) · [Design system](docs/DESIGN.md) ·
[Decisions](docs/DECISIONS.md) · [Roadmap](docs/ROADMAP.md)

---

## Layout

```
project/
  apps/
    mobile/           Expo app — BOTH roles, one build
      app/(auth)/ (farmer)/ (transporter)/
      components/  lib/  theme.ts
    admin/            Vite + React operator console (4 tabs)
    server/           Express + Socket.io + Mongoose
      src/modules/    auth users vehicles documents transport matching
                      payments ratings chat notifications ai realtime admin maps
  packages/shared/    types, enums, and the 25 error codes shared by both
  tests/              integration suites that run against a live server
  docs/
```

## Running it

**Prerequisites:** Node 20+, Expo SDK 54 (React Native 0.81, React 19), and a MongoDB
replica set (Atlas, or a local container).
The booking commit uses a transaction, so a bare standalone `mongod` degrades to the
conditioned update alone — which is still what guarantees single-booking.

```bash
# 1. dependencies
npm install

# 2. configuration
cp .env.example .env        # then fill in what you have — see "Running without keys"

# 3. database (local option)
podman run -d --name kisanpool-mongo -p 27017:27017 mongo:7 --replSet rs0
podman exec kisanpool-mongo mongosh --quiet --eval \
  'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'
# then set MONGODB_URI=mongodb://127.0.0.1:27017/kisanpool?directConnection=true

# 4. demo data
npm run seed

# 5. backend
npm run dev:server          # http://localhost:4000

# 6. app (separate terminal)
npm run dev:mobile          # Expo — press a / i, or scan the QR

# 7. admin console (separate terminal)
npm run dev:admin           # http://localhost:5173 — login admin / admin
```

### Seeded accounts

Sign in with the phone number; the OTP is printed to the server console.

| Phone | Who | Notes |
|---|---|---|
| `9000000001` | Rahul Patil, farmer | Marathi, default pickup in Pimpri, Pune |
| `9000000002` | Mahesh Jadhav, transporter | Truck, 4000 kg, verified |
| `9000000003` | Sunil Kadam, transporter | Mini truck, 2500 kg, verified |
| `9000000004` | Anil Shinde, transporter | Tempo, 1500 kg, verified |
| `9000000005` | Vikas Pawar, transporter | **KYC pending** — receives no matches, so the gate is visible |

Any other 10-digit number creates a fresh account, so you can play both sides at once.

### Running without keys

Every third-party integration degrades honestly rather than faking a result:

| Missing | What happens |
|---|---|
| `OTP_PROVIDER_API_KEY` | The OTP is logged to the server console and returned as `devCode`. With a key set, the code goes only to the handset — it is never in the API response |
| `RAZORPAY_*` | Checkout runs in demo mode; verify → capture → booking commit still runs end to end, signature check skipped only for demo order ids |
| `GOOGLE_MAPS_API_KEY` | Distance falls back to straight-line × 1.3 with no polyline; a trip is never blocked on the map layer |
| `CLOUDINARY_URL` | KYC and delivery photos are written to `apps/server/uploads/` and served from `/uploads` |
| Expo Go (not a key) | Remote push is unavailable — Expo Go dropped it in SDK 53. Registration no-ops with a console warning; sockets still deliver live updates. Use a development build to test notifications |
| `SARVAM_API_KEY` | `/ai/stt` and `/ai/tts` return `AI_TOOL_ERROR`; `/ai/chat` uses a deterministic fallback parser that understands less but still never invents a fact |

## SMS (Fast2SMS)

OTP delivery uses [Fast2SMS](https://www.fast2sms.com/). Set `OTP_PROVIDER_API_KEY` and pick
a route with `FAST2SMS_ROUTE`:

| Route | What it does | Account requirement |
|---|---|---|
| `otp` | Fast2SMS's own OTP template, code substituted in | **Website verification** on their dashboard, or it fails with status 996 |
| `q` | Quick SMS — we supply the message text | Works on a fresh account |
| `dlt` | DLT-registered template | `FAST2SMS_SENDER_ID` + `FAST2SMS_MESSAGE_ID` |

A send failure fails the request with `EXTERNAL_SERVICE_ERROR`. It is never reported as
success — a farmer told "code sent" who receives nothing has no way forward. The provider's
exact reason is logged server-side; the OTP itself never is.

## Admin console

`npm run dev:admin` → http://localhost:5173. Default login **admin / admin**; set
`ADMIN_USERNAME` and `ADMIN_PASSWORD` in `.env` to change it. The server warns at startup
and the console shows a banner while the defaults are in use.

Four tabs:

| Tab | What it does |
|---|---|
| **Overview** | Users, vehicles, trips, tonnes moved, money collected and paid out, capacity utilisation, average rating, documents awaiting review |
| **Users** | Every farmer and transporter with their vehicle, trip counts, rating and join date. Search by name or phone, filter by role |
| **Verification** | KYC grouped by transporter — approve or reject each document. Approving both **RC** and **DL** flips the vehicle to `VERIFIED`, which is the only thing that makes it visible to matching |
| **Vehicles** | Which vehicles are on the road, what they are carrying and where they last reported. Change status, verification and location; auto-refreshes every 15s |

Operators authenticate with a separate `admin` JWT claim, not a `User.role` — a marketplace
token is rejected with `AUTH_FORBIDDEN` on every `/admin/*` route. The console cannot bypass
the KYC gate: setting an unverified vehicle to `AVAILABLE` fails with `KYC_PENDING_REVIEW`.

## `bin/killport`

Frees a port when a dev server is left holding one — which happens often here, with the
API on 4000, Metro on 8081 and the admin console on 5173.

```bash
killport 4000              # graceful stop, SIGKILL only if it ignores SIGTERM
killport 4000 8081 5173    # several at once
killport -l 4000           # who is holding it? kill nothing
killport -9 4000           # skip the graceful stop
```

Plain `sh` with no runtime to boot, so it returns as fast as `ss` can answer. Symlink it
onto your PATH once:

```bash
ln -sf "$PWD/bin/killport" ~/.local/bin/killport
```

## Tests

```bash
npm run seed && npm run dev:server     # in one terminal
npm test                                # in another
```

**The suites need Razorpay in demo mode** — leave `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`
blank for the server process you test against. With real keys the server correctly refuses
the suite's synthetic signature (`PAYMENT_SIGNATURE_INVALID`), which is the security
property working as designed: a valid signature cannot be produced without an actual
payment. Everything else — matching, sockets, the AI contract — runs against real keys.

73 checks across four suites, run against a live server:

| Suite | Covers |
|---|---|
| `01_core_flow.py` | Auth, the KYC gate, matching and ranking, the 60/40 split, accept → payment → booking, status transitions, cancellation policy, auth boundaries, webhook signature |
| `02_concurrency_payouts.py` | Two concurrent accept-and-pay attempts on one vehicle, the loser's automatic refund, cancellation refund minus the configured fee, proof of delivery, automatic payout, rating rollup |
| `03_realtime.mjs` | Socket handshake auth, room authorisation, `match:new`, `payment:captured`, `trip:status`, live location with ETA, chat delivery and history |
| `04_servo_ai.py` | The six-tool contract, spoken confirmation before state changes, ambiguity producing questions, checkout handoff without payment, identity from the JWT |

Typechecking:

```bash
npm run typecheck        # server, app and shared package
```

## Hard rules

Enforced in code, not convention — see [`CLAUDE.md`](CLAUDE.md):

- The LLM never writes to the database and never invents a price, vehicle, ETA or booking id.
- No payment is confirmed client-side alone; a server-verified signature and the webhook are what mark it paid.
- KYC-unverified vehicles never appear in matching — the filter is in the query.
- A booking commits only after payment capture; a lost race refunds automatically.
- Every response uses the `{ success, data|error, requestId }` envelope with one of exactly 25 error codes.
- One design system, the Farmer set: Inter, `#0d631b` / `#2e7d32`, radii 8 / 16 / 24.
