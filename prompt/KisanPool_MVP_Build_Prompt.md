# KisanPool — Final MVP Build Prompt (single brief for a coding agent)

> Paste this whole document to your coding agent (Claude Code, Cursor, etc.) as the task brief. It covers the app (one Expo app, two roles), the backend, the Sarvam voice assistant, and Razorpay-based payments/payouts, plus trust-and-safety features borrowed from how real Indian logistics marketplaces (Porter, BlackBuck) operate — as one coherent build.

---

## 0. What we're building, in one paragraph

KisanPool matches a farmer's produce-transport request with a nearby transporter (vehicle) that has spare capacity, splits the trip cost between the farmer(s) sharing that vehicle, tracks the trip live on a map, collects payment through Razorpay and pays the transporter out automatically, and lets the farmer optionally do the whole thing by voice in their own Indian language through "Servo AI" (Sarvam AI). There is **one app**, one login, and a role switch inside it — not two separate builds. One backend serves it. **The AI never decides anything and money never moves outside a recorded transaction; it only calls the same backend APIs a human would tap on screen.**

**Golden rule (keep this true everywhere):** AI understands → Backend decides → Matching engine calculates → Payment settles it → Database records everything → Frontend presents.

---

## 1. What real competitors do that we should borrow (quick research summary)

Before designing further, here's what similar Indian logistics marketplaces already prove out, and what we're taking from each:

- **Porter** (intra-city, asset-light marketplace): return-trip/empty-leg matching so trucks aren't driven back empty, upfront cost estimation before booking, GST-style digital invoices on every trip, live tracking for the customer. → We already do return-load matching per the original brief; we're adding upfront cost estimation and a digital receipt.
- **BlackBuck**: cashless payments only (UPI/card/netbanking, no cash handover to the driver), an in-app "passbook" of every transaction, instant/fast payouts to the transporter's bank account, verified-transporter badges with visible ratings, document verification before a transporter can accept loads, and easy dispute resolution because everything is digital. → We're adding all of these: KYC before payout eligibility, a passbook screen, Razorpay-powered instant-ish payouts, and ratings.
- **General marketplace patterns** (accept/reject/cancel, driver earnings + analytics, push notifications, chat/call support): → We're adding accept/reject with a cancellation policy, a simple earnings view, push notifications, and in-trip chat.

These are folded into the plan below, not bolted on as an appendix — treat §8 and §9 as core MVP scope, not stretch goals, since payments and trust are what make this feel like a real product instead of a demo.

---

## 2. Tech stack — deliberately minimal, enhanced only where it earns its keep

| Layer | Choice | Why |
|---|---|---|
| Mobile app | **React Native + Expo (single app, TypeScript)** | One codebase, one build — role is a field on the user, not a separate app |
| Navigation | **Expo Router**, role-gated route groups: `(farmer)` vs `(transporter)` mounted from the same root after login | Two experiences, one project |
| Data fetching | **Plain `fetch()`** wrapped in one `api.ts` helper. No React Query/Axios/Redux. | Simplest thing that works |
| Real-time | **Socket.io** (`socket.io-client` in Expo, `socket.io` on Express) | Live match offers, trip status, live vehicle location, in-trip chat — genuinely needs a socket, not polling |
| Push notifications | **`expo-notifications`** + Expo Push API | So a farmer/transporter gets notified even when the app is backgrounded (match found, payment received, trip update) — sockets alone don't cover a closed app |
| Maps & tracking | **`react-native-maps`** with `PROVIDER_GOOGLE` + Google Directions API | All pickup/destination pickers, match results, and live trip tracking |
| Backend | **Node.js + Express** | One process, REST + Socket.io on the same HTTP server |
| Database | **MongoDB + Mongoose** | Per project requirement |
| File storage | **Cloudinary (or any S3-compatible bucket)** for KYC documents and proof-of-delivery photos | Needed once documents/photos enter the picture — don't store binary blobs in Mongo |
| Auth | **Phone + OTP → JWT (access + refresh)** | Matches both source docs |
| Voice assistant | **Sarvam AI** — STT (`saaras:v3`), TTS (`bulbul:v3`), Language ID (`/text-lid`), Chat Completion (`sarvam-m`) | Indian-language-native, one vendor for the whole voice pipeline |
| Payments & payouts | **Razorpay** — Orders API (collect farmer payment), Route (auto-split/transfer transporter's share to their linked account), Refunds API (cancellations) | Purpose-built for exactly this marketplace-split use case in India |
| Hosting (MVP) | Single Express app + Socket.io + MongoDB Atlas free tier | No infra to manage for a hackathon timeline |

---

## 3. Repository layout

```
kisanpool/
  apps/
    mobile/                 # Expo app — BOTH roles live here
      app/
        (auth)/
        (farmer)/
        (transporter)/
      components/
        VoiceAssistantButton.tsx
        TripMap.tsx
        ChatSheet.tsx
        RatingStars.tsx
      lib/
        api.ts
        socket.ts
        sarvam.ts
        razorpayCheckout.ts
    server/
      src/
        modules/
          auth/ users/ vehicles/ documents/ transport/ matching/
          payments/ ratings/ chat/ notifications/ ai/ realtime/
        server.ts
  packages/
    shared/                  # shared TS types/enums
  .env.example
  README.md
```

---

## 4. The app — one Expo project, role-aware navigation

### 4.1 How the role switch works

- `User.role: 'FARMER' | 'TRANSPORTER'` is set once at onboarding.
- After OTP verification, the root navigator reads `role` and mounts the matching stack. Shared shell: header, voice assistant button, `<TripMap />`, socket connection, notification permission prompt.
- One role per account for the MVP — a farmer who also drives gets a second account later; don't build multi-role switching now.

### 4.2 Porting the provided UI (Stitch HTML exports → RN components)

Rebuild each screen natively using the colors/type scale/spacing/radii from each export's `DESIGN.md`, translated into a shared `theme.ts` (same token values as before — primary `#0d631b`/`#2e7d32`, surfaces around `#f8faf8`–`#eceeec`, Inter font, 8/16/24px radii). Use the Transporter export's slightly darker `agri_tech_premium` tones only for transporter-only screens if you want subtle differentiation; otherwise share one theme.

**Farmer screens** (source: `stitch_kisanpool_farmer_app_ui_ux.zip`), extended with the new payment/trust features:

| Screen folder / new screen | RN route | Purpose |
|---|---|---|
| `f0.1_welcome_language` | `(auth)/welcome` | Welcome + language picker — sets default Sarvam language |
| `f0.2_role_selection` | `(auth)/role` | Choose Farmer vs Transporter |
| `f0.3_mobile_verification` | `(auth)/verify` | Phone + OTP |
| `f0.4_farmer_details` | `(auth)/farmer-details` | Name, default pickup location (Google Places autocomplete) |
| `f0.5_onboarding_success` | `(auth)/success` | Confirmation; also request push-notification permission here |
| `f1_farmer_home` | `(farmer)/home` | Dashboard, "New Request" CTA, recent requests, **Servo AI mic button** |
| `f2_mandi_discovery` | `(farmer)/mandis` | Browse nearby mandis on a Google Map + list |
| `f3_mandi_details` | `(farmer)/mandis/[id]` | Mandi detail — price trend, distance, "Ship here" |
| `f4_smart_pool_match` | `(farmer)/requests/[id]/matches` | Ranked matches (top 3), cost split, transporter rating badge, "Accept Match" — live-updated over socket |
| *(new)* | `(farmer)/requests/[id]/checkout` | Razorpay Checkout for the farmer's share, shown right after accepting a match, before the booking is finalized |
| `f5_active_trip_tracking` | `(farmer)/trips/[id]` | Live Google Map tracking, plus an in-trip **chat** button and driver **call** button |
| *(new)* | `(farmer)/trips/[id]/rate` | Rate & review the transporter after delivery |
| *(new)* | `(farmer)/payments` | Passbook — list of past payments, receipts, refund status |

**Transporter screens** (source: `stitch_kisanpool_transporter_app_ui_ux.zip`), extended the same way:

| Screen folder / new screen | RN route | Purpose |
|---|---|---|
| `onboarding_registration` | `(auth)/vehicle-register` | Vehicle type, capacity, phone/OTP |
| *(new)* | `(auth)/kyc` | Upload RC, driving licence, and (for payouts) PAN + bank details — feeds Razorpay Route onboarding; vehicle stays "Pending Verification" and can't accept matches until KYC is approved |
| `transporter_dashboard` | `(transporter)/home` | Availability toggle, earnings summary, live counts (socket-updated), verification status banner if still pending |
| `available_trips` | `(transporter)/trips/available` | List + mini-map of matched/pending requests, accept/reject with a reason |
| `active_trip_management` | `(transporter)/trips/[id]` | Live map, status buttons, chat + call with farmer, publishes GPS over the socket every few seconds |
| `trip_completion_billing` | `(transporter)/trips/[id]/complete` | Mark delivered (with a **proof-of-delivery photo** upload), final cost split, triggers payout |
| *(new)* | `(transporter)/trips/[id]/rate` | Rate the farmer after delivery |
| *(new)* | `(transporter)/payouts` | Earnings passbook — every payout, its Razorpay transfer status, and a running total |

`f0_onboarding_auth` is the shared stepper container for all onboarding screens (farmer and transporter), including the new KYC step.

### 4.3 App-side rules (unchanged approach, same helper style)

- `api.ts` — same shape as before: one function per REST resource, JWT from `expo-secure-store`, throws on `success:false`.
- `socket.ts` — connects once per screen that needs it (match results, active trip, chat), disconnects on unmount, JWT passed via `auth: { token }` in the handshake.
- `razorpayCheckout.ts` — thin wrapper around `react-native-razorpay`'s native checkout: takes `{ orderId, amount, keyId, prefill }`, opens the checkout sheet, resolves with `{ razorpay_payment_id, razorpay_order_id, razorpay_signature }` or rejects on cancel/failure.
- `<TripMap />` — one shared component (markers + optional live vehicle marker + optional route polyline), reused across mandi discovery, match results, and trip tracking.
- Notification handling: register the Expo push token on login (`PATCH /users/me { pushToken }`), and let the server fire pushes for: new match found, payment captured, trip status changed, new chat message (only if the app is backgrounded).

---

## 4.4 Cancellation & refund policy (define this explicitly, don't leave it implicit)

| When cancelled | Farmer's payment | Notes |
|---|---|---|
| Before a match is accepted | N/A — no payment taken yet | Just cancels the `TransportRequest` |
| After accept, before pickup | Full refund minus a small platform cancellation fee (e.g. 5%) | Use Razorpay Refunds API; vehicle capacity is released back |
| After pickup | No refund by default (support can override manually) | Trip is already in motion; treat as an edge case handled by a human, not automated |

Keep the percentages as config values, not hardcoded — a `PLATFORM_CANCELLATION_FEE_PCT` env/config value is enough for the MVP.

---

## 5. Backend — data model (MongoDB / Mongoose)

```js
// User
{
  _id, name, phone (unique), role: 'FARMER' | 'TRANSPORTER',
  language: 'mr' | 'hi' | 'en' | ...,
  defaultLocation: { name, lat, lng },
  pushToken,
  ratingAvg, ratingCount,                       // rolled up from Rating docs
  phoneVerifiedAt, createdAt, updatedAt
}

// Vehicle
{
  _id, ownerId (ref User), vehicleType: 'PICKUP'|'TRUCK'|'TEMPO'|'TRACTOR'|'MINI_TRUCK'|'OTHER',
  capacityKg, availableCapacityKg,
  currentLocation: { lat, lng },
  ratePerKm,
  status: 'AVAILABLE'|'BUSY'|'OFFLINE',
  verificationStatus: 'PENDING'|'VERIFIED'|'REJECTED',   // gates whether it can accept matches
  createdAt, updatedAt
}

// Document (KYC)
{
  _id, userId (ref User), type: 'RC'|'DL'|'AADHAAR'|'PAN',
  fileUrl, status: 'PENDING'|'VERIFIED'|'REJECTED', reviewedAt, createdAt
}

// TransportRequest
{
  _id, farmerId (ref User),
  cropType, quantityKg,
  pickup: { name, lat, lng },
  destination: { name, lat, lng },
  preferredDate,
  status: 'DRAFT'|'SEARCHING'|'MATCHED'|'PAYMENT_PENDING'|'BOOKED'|'IN_TRANSIT'|'DELIVERED'|'CANCELLED',
  createdAt, updatedAt
}

// Match
{
  _id, requestId (ref TransportRequest), vehicleId (ref Vehicle),
  score, distanceKm, totalCost,
  farmerShare, transporterShare,                // 60% / 40% cost split
  status: 'PENDING'|'ACCEPTED'|'REJECTED'|'EXPIRED',
  createdAt
}

// Payment
{
  _id, requestId (ref TransportRequest), farmerId (ref User),
  razorpayOrderId, razorpayPaymentId, razorpaySignature,
  amount, currency: 'INR',
  status: 'CREATED'|'PAID'|'FAILED'|'REFUNDED'|'PARTIALLY_REFUNDED',
  platformFee, transporterPayoutAmount,
  transferId,                                    // Razorpay Route transfer id, once settled
  createdAt, updatedAt
}

// TransporterPayoutAccount (Razorpay Route linked account)
{
  _id, userId (ref User),
  razorpayContactId, razorpayFundAccountId, razorpayAccountId,
  payoutStatus: 'NOT_ONBOARDED'|'PENDING'|'ACTIVE',
  createdAt, updatedAt
}

// Rating
{
  _id, tripId (ref TransportRequest), fromUserId, toUserId,
  stars (1-5), comment, createdAt
}

// ChatMessage
{
  _id, tripId (ref TransportRequest), senderId, text, createdAt
}

// AiSession
{
  _id, userId (ref User), history: [{ role, content, ts }], detectedLanguage, updatedAt
}
```

Keep enums as plain Mongoose string unions — no separate validation package needed at this scale.

---

## 6. Backend — REST + Socket.io API

### 6.1 REST

```
POST   /auth/request-otp        { phone }
POST   /auth/verify-otp         { phone, code }              -> { accessToken, refreshToken, user }
POST   /auth/refresh            { refreshToken }
GET    /users/me
PATCH  /users/me                { pushToken?, language?, ... }

POST   /vehicles                (register/update vehicle)
PATCH  /vehicles/:id/availability  { status }

POST   /documents                multipart upload { type }   -> KYC document, starts PENDING
GET    /documents/me
PATCH  /documents/:id/review     { status }                    (internal/admin — approve/reject KYC)

POST   /transport/requests               { cropType, quantityKg, pickup, destination, preferredDate }
GET    /transport/requests/:id
GET    /transport/requests/:id/matches   -> top 3 ranked vehicles, each with the vehicle owner's ratingAvg
POST   /transport/requests/:id/accept    { vehicleId }         -> creates Payment(CREATED), request -> PAYMENT_PENDING
PATCH  /transport/requests/:id/status    { status }            (PICKED_UP, IN_TRANSIT, DELIVERED)
POST   /transport/requests/:id/cancel    { reason }             -> applies cancellation policy from §4.4
POST   /transport/requests/:id/pod       multipart image        -> proof-of-delivery photo (transporter, on DELIVERED)

POST   /payments/create-order    { requestId } -> { razorpayOrderId, amount, keyId }
POST   /payments/verify           { razorpay_order_id, razorpay_payment_id, razorpay_signature }
POST   /payments/refund            { paymentId, reason }
POST   /webhooks/razorpay          (raw body; verify `x-razorpay-signature` header) -> handles payment.captured/failed, transfer.processed

POST   /transporters/payout-onboarding   { panNumber, bankAccountNumber, ifsc } -> creates Razorpay Route linked account
GET    /transporters/payouts              -> payout passbook

GET    /trips/:id/ratings
POST   /trips/:id/ratings         { stars, comment }

POST   /ai/stt                  multipart audio  -> Sarvam /speech-to-text, returns { transcript, language }
POST   /ai/tts                  { text, language } -> Sarvam /text-to-speech, returns base64 audio
POST   /ai/chat                 { message, sessionId } -> Servo AI entry point (see §7)

GET    /maps/directions         { origin, destination } -> Google Directions polyline + ETA (cache per request)
```

Every response follows one shape:
```json
{ "success": true, "data": { }, "requestId": "req_123" }
{ "success": false, "error": { "code": "NO_VEHICLE_AVAILABLE", "message": "..." }, "requestId": "req_123" }
```

### 6.2 Socket.io events

```
# client -> server
join:request         { requestId }
join:trip             { tripId }
vehicle:location       { tripId, lat, lng }        // transporter pushes GPS every ~5s during an active trip
chat:send                { tripId, text }

# server -> client
match:new              { requestId, match }
trip:status              { tripId, status, at }
trip:location             { tripId, lat, lng, etaMinutes }
payment:captured          { requestId, paymentId }
chat:message                { tripId, senderId, text, ts }
```

Rooms are `requestId`/`tripId` strings. Authenticate the socket handshake with the same JWT as REST.

### 6.3 Matching & pricing (deterministic, backend-only, never touched by the LLM)

1. Filter vehicles where `status = AVAILABLE`, `verificationStatus = VERIFIED`, and `availableCapacityKg >= quantityKg`. **Unverified vehicles never appear in matches** — this is the KYC gate.
2. Score: **60% proximity** (haversine, vehicle → pickup, normalized) + **40% capacity utilization** (`quantityKg / capacityKg`).
3. Return top 3 as `Match` (`PENDING`), emit `match:new`.
4. Cost: `totalCost = distanceKm * ratePerKm` (real driving distance from `/maps/directions` once available); `farmerShare = totalCost * 0.6`, `transporterShare = totalCost * 0.4`.
5. On accept: create a `Payment` doc (`CREATED`) for `farmerShare` and move the request to `PAYMENT_PENDING` — the booking is **not** confirmed until payment is captured (§8).
6. On payment captured: inside a MongoDB session — re-check capacity with a conditioned `findOneAndUpdate`, confirm `Match` (`ACCEPTED`), set request `BOOKED`, decrement vehicle capacity, mark `BUSY` if full, emit `trip:status`. Reject with `VEHICLE_CAPACITY_EXCEEDED` if the race lost — and refund the payment immediately if that happens.

Keep this in one `matchingService.js` plus one `paymentService.js` — the two pieces of business logic worth isolating.

---

## 7. Servo AI — the Sarvam-powered voice assistant

### 7.1 Why proxy Sarvam through the backend

Keep the Sarvam API key server-side; the Expo app only calls your own `/ai/stt`, `/ai/tts`, `/ai/chat`.

### 7.2 Client flow (mic button on `f1_farmer_home`, and optionally transporter home)

1. Tap mic → `expo-av` records audio.
2. `POST /ai/stt` (multipart) → `{ transcript, language }`.
3. `POST /ai/chat` with `{ message: transcript, sessionId }` → `{ reply, language, action, data }`.
4. `POST /ai/tts` with `{ text: reply, language }` → base64 audio → play with `expo-av`.
5. If `action` is a navigation, navigate there with the data already fetched.

### 7.3 Server side

```
Audio -> POST https://api.sarvam.ai/speech-to-text (model saaras:v3, mode "transcribe", header api-subscription-key)
  -> { transcript, detected language }
  -> POST /ai/chat { message: transcript, sessionId }
     -> load AiSession history
     -> one Sarvam Chat Completion call (model sarvam-m): extract intent + entities + confirm language, JSON only
     -> map intent to an AI-safe tool
     -> tool calls the SAME service functions the REST routes use
     -> compose a short reply in the detected language
  -> client calls /ai/tts (model bulbul:v3) to speak it
```

**AI-safe tool contract:**

```js
getUserProfile()
findMatchingVehicles({ pickupLocation, destination, cropType, quantityKg, preferredDate })
createTransportRequest({ cropType, quantityKg, pickupLocation, destination, preferredDate })
acceptMatch({ requestId, vehicleId })          // requires spoken confirmation, then hands off to the Payment screen — the assistant does not collect payment itself
getTripStatus({ requestId })
cancelRequest({ requestId, reason })
```

**Non-negotiable safety rules:**
- Authenticated user ID comes from the JWT, never from speech.
- The LLM never writes to MongoDB directly, never invents a price/vehicle/ETA/booking ID, and **never initiates or confirms a payment** — accepting a match via voice still routes the farmer to the Razorpay checkout screen for the actual payment step.
- State-changing actions require the assistant to state what it's about to do and get a clear yes first.
- Ambiguous intent → the assistant asks a follow-up question instead of guessing.

### 7.4 Language handling

Use Sarvam's `/text-lid` only as a confirmation pass if the STT-reported language seems inconsistent with the conversation; otherwise trust the STT model's own tag. Start with Marathi, Hindi, and English for testing — the tool contract doesn't change as more languages are added.

---

## 8. Payments & payouts — Razorpay

### 8.1 Flow

```
Farmer accepts a match
   │
   ▼
Backend creates a Razorpay Order for farmerShare  ->  POST /payments/create-order
   │
   ▼
App opens Razorpay Checkout (react-native-razorpay) with { orderId, amount, keyId }
   │
   ▼
Farmer pays via UPI / card / netbanking (Razorpay handles the instrument, not us)
   │
   ▼
App gets { razorpay_payment_id, razorpay_order_id, razorpay_signature } back
   │
   ▼
App calls POST /payments/verify  ->  backend recomputes the HMAC-SHA256 signature
   with the key secret and compares — only trust a payment if this matches
   │
   ▼
Payment.status = PAID  ->  matchingService confirms the booking (§6.3 step 6)
   │
   ▼
On trip DELIVERED: backend creates a Razorpay Route transfer, moving
transporterShare (minus platform fee) to the transporter's linked account
   │
   ▼
Razorpay webhook (payment.captured / transfer.processed) is the source of truth
for reconciliation — don't only trust the client-side callback
```

### 8.2 Backend implementation notes

- `npm i razorpay` — create the Orders API order with `amount` in paise and `currency: 'INR'`, tagged with `receipt: requestId`.
- **Signature verification** (do this server-side, never trust the client alone):
  ```js
  const crypto = require('crypto');
  function verifySignature({ orderId, paymentId, signature }) {
    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
    return expected === signature;
  }
  ```
- **Webhooks**: register a webhook URL in the Razorpay dashboard for `payment.captured`, `payment.failed`, `transfer.processed`. Verify the `x-razorpay-signature` header the same way (HMAC of the raw request body with the webhook secret) before trusting the payload — this is what actually confirms money moved, independent of whether the app stayed open.
- **Payouts (Razorpay Route)**: onboard each transporter as a Linked Account (needs PAN + bank account/IFSC, collected in the new `(auth)/kyc` screen) before they can be paid out; store the resulting `razorpayAccountId` on `TransporterPayoutAccount`. When creating the farmer's payment order (or the transfer afterward), specify a `transfers` array with the transporter's linked account and `transporterShare` — Razorpay keeps the remainder (`platformFee`) automatically.
- **Refunds**: `POST /payments/refund` calls Razorpay's Refunds API for the cancellation-policy amount from §4.4; a refund can't be requested once a transfer for that payment has already gone out, so cancellations after pickup are handled manually, not automatically refunded.
- **Digital receipt**: after `payment.captured`, generate a simple receipt (HTML view is enough for the MVP; a PDF export is a nice add-on, not a blocker) showing crop, weight, route, cost split, and payment ID — this is the "GST-style invoice" trust signal Porter/BlackBuck both lean on, without needing actual GST registration for a hackathon MVP.

### 8.3 What NOT to build for the MVP

- No wallet/stored-value system — Razorpay Route handles the split, don't build your own ledger beyond the `Payment`/`TransporterPayoutAccount` records above.
- No multi-currency, no international payment methods — INR only.
- No custom card-storage/tokenization — let Razorpay Checkout handle the payment instrument entirely; you only ever see order/payment IDs.

---

## 9. Trust & safety features (from the competitor research in §1)

- **KYC gating**: a `Vehicle` stays `verificationStatus: PENDING` — and invisible to matching — until its owner's `RC` + `DL` documents (and PAN + bank details for payouts) are reviewed and marked `VERIFIED`. For the MVP, "review" can be a manual admin action (a protected `PATCH /documents/:id/review` route you call yourself during the demo) rather than a full admin dashboard.
- **Ratings**: after a trip reaches `DELIVERED`, both sides get prompted to rate the other (1–5 stars + optional comment). Roll the average into `User.ratingAvg` and surface it on the match cards (`f4_smart_pool_match`) and available-trips list, the same way BlackBuck shows verified-transporter ratings.
- **In-trip chat + call**: a lightweight `ChatMessage` list per trip over the `chat:send`/`chat:message` socket events, plus a plain `tel:` link button to call the other party directly — no need for a masked-number/VoIP proxy at MVP stage.
- **Push notifications**: match found, payment captured, trip status changes, and new chat messages all fire an Expo push when the recipient's app is backgrounded — this is what makes the live socket updates actually reliable in practice, since a closed app won't see a socket event.
- **Proof of delivery**: transporter uploads one photo when marking a trip `DELIVERED` (stored via Cloudinary/S3, URL on the request) — this is the digital paper trail that BlackBuck cites as enabling "easy dispute resolution."
- **Cancellation policy**: enforced exactly as defined in §4.4, not left to ad-hoc support judgment.

---

## 10. Auth flow

1. `POST /auth/request-otp` — 6-digit OTP, hashed with a short TTL (a field on the user, or an in-memory map — no Redis just for this).
2. `POST /auth/verify-otp` — check code, mark `phoneVerifiedAt`, issue JWT access + refresh tokens.
3. `POST /auth/refresh` — standard rotate.
4. All `/transport/*`, `/vehicles/*`, `/documents/*`, `/payments/*`, `/ai/*`, `/maps/*` REST routes and the Socket.io handshake require a valid access token. `/webhooks/razorpay` is the one route authenticated by Razorpay's signature instead of a JWT.

---

## 11. Environment variables

```
PORT=4000
MONGODB_URI=mongodb+srv://.../kisanpool
JWT_SECRET=
JWT_REFRESH_SECRET=
OTP_PROVIDER_API_KEY=              # or log OTP to console for demo

SARVAM_API_KEY=                    # api-subscription-key header for all Sarvam calls

GOOGLE_MAPS_API_KEY=               # Directions API (server) + Maps SDK (Expo app, separate restricted key)

RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
PLATFORM_CANCELLATION_FEE_PCT=5

CLOUDINARY_URL=                    # or S3_BUCKET / S3_ACCESS_KEY / S3_SECRET_KEY

EXPO_PUBLIC_API_URL=http://localhost:4000
EXPO_PUBLIC_SOCKET_URL=http://localhost:4000
EXPO_PUBLIC_RAZORPAY_KEY_ID=       # public key id only, safe on the client
```

---

## 12. Build order

0. **Documentation & decision records** — before any implementation code, generate `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/API_CONTRACTS.md`, `docs/DESIGN.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md`, and a root `CLAUDE.md` from this brief (see the companion "Documentation Generation Prompt"). Claude Code should treat these as the source of truth for every later session, not just this brief file.
1. **Backend skeleton** — Express, Mongo connection, all models, Socket.io on the same HTTP server.
2. **Auth** — OTP request/verify, JWT issue/refresh.
3. **Core CRUD** — vehicle registration, transport request creation, document upload (KYC skeleton, manual review endpoint).
4. **Matching service** — scoring + top-3 + cost split, gated on `verificationStatus`; wire `match:new`.
5. **Payments** — Razorpay order creation, signature verification, webhook handler; booking only confirms after `payment.captured`.
6. **Booking transaction** — accept-match + payment-confirmed capacity commit, with the concurrency test (two accepts, only one should end up paid+booked; the loser gets auto-refunded).
7. **Payouts** — Razorpay Route linked-account onboarding for transporters, transfer creation on `DELIVERED`, payout passbook endpoint.
8. **Google Maps integration** — Directions proxy, shared `<TripMap />`, live location relay over sockets.
9. **Expo app — Farmer flow** — port `f0.1`→`f5` plus the new checkout, rating, and passbook screens.
10. **Expo app — Transporter flow** — port its five screens plus KYC onboarding, ratings, and payout passbook.
11. **Trust & safety layer** — ratings, in-trip chat, push notifications, proof-of-delivery upload, cancellation/refund flow.
12. **Servo AI (Sarvam)** — `/ai/stt`, `/ai/tts`, `/ai/chat` and the tool contract, then the mic button — last, since it wraps everything above (including handing off to the real Checkout screen instead of trying to pay by voice).

## 13. MVP definition of done

- One Expo app; a farmer and a transporter each log in by phone/OTP and land on their own home screen from the same build.
- A transporter can't receive matches until their vehicle's KYC documents are marked verified.
- Farmer submits a request, sees ranked matches (with transporter ratings visible, live-updated over the socket), accepts one, **pays their share through Razorpay Checkout**, and only then is the booking confirmed.
- Farmer watches the transporter's vehicle move in real time on a Google Map through delivery, can chat or call them, and gets push notifications for every status change.
- Transporter uploads a proof-of-delivery photo to mark a trip delivered, which **triggers an automatic Razorpay Route payout** of their share.
- Two concurrent accept-and-pay attempts on the same vehicle never both end up booked; the loser is refunded automatically.
- Cancellations before pickup are refunded per the policy in §4.4; a webhook, not just the client callback, is what finally marks a `Payment` as `PAID`/`REFUNDED`.
- Both sides can rate each other after delivery, and ratings show up on future match cards.
- Speaking a request to Servo AI (Sarvam STT → chat → TTS) produces the same request → match → **checkout handoff** → booking flow as the manual UI, in the farmer's own language, and never itself moves money or invents a fact that didn't come from a real tool call.
