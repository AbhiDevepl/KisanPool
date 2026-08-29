# KisanPool — System Architecture

Derived from `prompt/KisanPool_MVP_Build_Prompt.md` §2–§10. Read this with `docs/API_CONTRACTS.md` before changing anything.

---

## 1. High-level view

```
                      ┌──────────────────────────────────┐
                      │      Expo App (React Native)     │
                      │  one build · TypeScript          │
                      │                                  │
                      │  (auth)/  (farmer)/  (transporter)/
                      │  lib/api.ts   lib/socket.ts      │
                      │  lib/sarvam.ts  lib/razorpayCheckout.ts
                      └───────┬───────────────┬──────────┘
                              │ REST (JWT)    │ Socket.io (JWT handshake)
                              ▼               ▼
                  ┌───────────────────────────────────────┐
                  │   Express + Socket.io (one process)    │
                  │                                       │
                  │  modules/                             │
                  │   auth  users  vehicles  documents    │
                  │   transport  matching  payments       │
                  │   ratings  chat  notifications        │
                  │   ai  realtime                        │
                  └───┬──────┬──────┬──────┬──────┬───────┘
                      │      │      │      │      │
        ┌─────────────┘      │      │      │      └──────────────┐
        ▼                    ▼      ▼      ▼                     ▼
┌───────────────┐   ┌────────────┐ │ ┌──────────────┐   ┌────────────────┐
│   MongoDB     │   │  Sarvam AI │ │ │  Razorpay    │   │ Cloudinary / S3│
│   (Atlas)     │   │  STT · TTS │ │ │  Orders      │   │ KYC docs, POD  │
│   Mongoose    │   │  chat · LID│ │ │  Route       │   │ photos         │
└───────────────┘   └────────────┘ │ │  Refunds     │   └────────────────┘
                                   │ │  Webhooks ───┼──▶ POST /webhooks/razorpay
                                   │ └──────────────┘        (signature-authenticated)
                                   ▼
                        ┌────────────────────────┐
                        │  Google Maps Platform  │
                        │  Directions API (srv)  │
                        │  Maps SDK (app key)    │
                        └────────────────────────┘

                        ┌────────────────────────┐
                        │  Expo Push API         │  ◀── notifications module
                        └────────────────────────┘
```

Everything the app talks to is our own backend. Sarvam, Razorpay's server APIs, Google Directions and Cloudinary are reached **only** from the server, so their keys never ship in the bundle. The two exceptions are deliberate and safe: the Google Maps SDK key restricted to the app, and `EXPO_PUBLIC_RAZORPAY_KEY_ID` (the public key id, which Razorpay Checkout requires client-side).

---

## 2. Component responsibilities

**Mobile app (`apps/mobile`).** One Expo Router project. After OTP verification the root navigator reads `User.role` and mounts either the `(farmer)` or the `(transporter)` group; `(auth)` holds the shared onboarding stepper for both roles including the KYC step. A shared shell provides the header, the Servo AI mic button, `<TripMap />`, the socket connection and the push-permission prompt. Data access is plain `fetch()` through `lib/api.ts` — no React Query, Axios or Redux — with the JWT read from `expo-secure-store` and any `success:false` response thrown as an error.

**Auth module (`modules/auth`).** Issues and rotates JWTs off phone + OTP. A 6-digit code is stored hashed with a short TTL (a field on the user or an in-memory map — no Redis for this). It also authenticates the Socket.io handshake with the same access token used for REST, so there is one identity model, not two.

**Users, vehicles, documents modules.** CRUD plus two gates that matter: `PATCH /users/me` is where the Expo push token is registered on login, and a `Vehicle` carries `verificationStatus` which the documents module flips to `VERIFIED` only after an operator reviews the uploaded RC and DL. Document binaries live in Cloudinary/S3; Mongo stores URLs.

**Matching service (`modules/matching`).** The only place scoring and pricing live. Deterministic and backend-only — filter on availability, verification and spare capacity; score 60% proximity (haversine, vehicle→pickup, normalized) + 40% capacity utilisation; return the top 3 as `PENDING` matches; compute `totalCost = distanceKm × ratePerKm` and the 60/40 split. It also owns the capacity commit that runs after payment capture, inside a MongoDB session with a conditioned `findOneAndUpdate`. No LLM code path ever enters this module.

**Payment service (`modules/payments`).** Creates the Razorpay order for the farmer's share, verifies the HMAC-SHA256 checkout signature, handles the Razorpay webhook as the authoritative confirmation, creates the Route transfer on delivery, and issues refunds per the cancellation policy. It calls into the matching service to confirm a booking — never the other way round.

**Realtime layer (`modules/realtime`).** Socket.io mounted on the same HTTP server as Express. Rooms are keyed by `requestId` or `tripId`. It carries new match offers, trip status transitions, live vehicle location with ETA, payment-captured notices and in-trip chat. It is a transport, not a source of truth: every event it emits reflects a state change already committed to MongoDB.

**AI layer (`modules/ai`).** Proxies Sarvam STT, TTS and chat completion so the API key stays server-side, holds `AiSession` history, and exposes exactly six tools to the model. Each tool calls the *same service function* a REST route calls — there is no second, looser path into the domain.

**Notification layer (`modules/notifications`).** Fires Expo pushes for match found, payment captured, trip status change and new chat message, so a backgrounded or closed app still learns what a socket event would have told it.

---

## 3. End-to-end sequence — the core flow

1. Farmer signs in: `POST /auth/request-otp` → `POST /auth/verify-otp` → access + refresh tokens; the app registers its Expo push token via `PATCH /users/me`.
2. Farmer submits a request: `POST /transport/requests` with crop, quantity, pickup, destination, preferred date. Status becomes `SEARCHING`.
3. The app opens a socket and emits `join:request { requestId }`.
4. The matching service filters to `AVAILABLE` + `VERIFIED` vehicles with enough spare capacity, scores them, and writes the top 3 as `Match` documents in `PENDING`.
5. Each match is emitted as `match:new` and rendered on `(farmer)/requests/[id]/matches` with the transporter's `ratingAvg` and the farmer's exact share.
6. Farmer taps Accept: `POST /transport/requests/:id/accept { vehicleId }`. The backend creates a `Payment` in `CREATED` for `farmerShare` and moves the request to `PAYMENT_PENDING`. **The booking is not confirmed here.**
7. The app routes to `(farmer)/requests/[id]/checkout`, calls `POST /payments/create-order`, and opens Razorpay Checkout with `{ orderId, amount, keyId }`.
8. Farmer pays. The SDK returns `{ razorpay_payment_id, razorpay_order_id, razorpay_signature }`; the app posts them to `POST /payments/verify`, which recomputes the HMAC server-side and only then trusts the payment.
9. Razorpay's `payment.captured` webhook arrives at `POST /webhooks/razorpay`, signature-verified against the raw body. This — not the client callback — is what finally marks the `Payment` `PAID`.
10. On capture the matching service commits the booking inside a MongoDB session: re-check capacity with a conditioned `findOneAndUpdate`, set the `Match` `ACCEPTED`, the request `BOOKED`, decrement `availableCapacityKg`, mark the vehicle `BUSY` if full, emit `trip:status`. If the conditioned update loses the race it fails with `CONCURRENT_BOOKING` and the payment is refunded immediately.
11. The transporter's app publishes `vehicle:location` every ~5s during the trip; the server relays `trip:location` with an ETA from the cached Google Directions result to everyone in the trip room.
12. Either side sends `chat:send`; the server persists a `ChatMessage` and relays `chat:message`, plus a push if the recipient is backgrounded.
13. Transporter marks delivered: `PATCH /transport/requests/:id/status { DELIVERED }` with a proof-of-delivery photo via `POST /transport/requests/:id/pod`.
14. Delivery triggers a Razorpay Route transfer of `transporterShare` (minus platform fee) to the transporter's linked account; `transfer.processed` on the webhook updates `Payment.transferId` and the payout passbook.
15. Both sides are prompted to rate: `POST /trips/:id/ratings`. Averages roll up into `User.ratingAvg` / `ratingCount` and appear on future match cards.

The voice path replaces steps 2–6 only: record → `/ai/stt` → `/ai/chat` (tool call) → `/ai/tts`, then the assistant hands off to the same checkout screen at step 7. It never continues past that handoff on its own.

---

## 4. The Golden Rule

> **AI understands → Backend decides → Matching engine calculates → Payment settles it → Database records everything → Frontend presents.**

Each arrow is a boundary, and the rule exists to rule three things out. **The LLM never writes to the database** — its six tools call the same service functions the REST routes call, and those services perform every validation they would perform for a human tap. **The LLM never invents a fact** — a price, an ETA, a vehicle, a booking ID or a status it reports must have come back from a real tool call, and when intent is ambiguous it asks a follow-up rather than filling the gap. **The client never confirms money** — a payment is `PAID` because a server-verified signature and a signature-verified webhook say so, not because a mobile SDK returned success; likewise the frontend renders state, it does not compute cost splits or matching scores locally.

---

## 5. Security & trust boundaries

- **JWT on everything.** All `/transport/*`, `/vehicles/*`, `/documents/*`, `/payments/*`, `/ai/*`, `/maps/*` routes and the Socket.io handshake require a valid access token. The authenticated user id always comes from the token — never from a request body, and never from speech.
- **One signature-authenticated exception.** `POST /webhooks/razorpay` has no JWT; it is authenticated by verifying the `x-razorpay-signature` header as an HMAC of the **raw** request body with `RAZORPAY_WEBHOOK_SECRET`. That route must be mounted with a raw-body parser before any JSON middleware, or verification silently fails.
- **Checkout signature verification.** `POST /payments/verify` recomputes `HMAC_SHA256(orderId + "|" + paymentId, RAZORPAY_KEY_SECRET)` and compares against the client-supplied signature. A mismatch is a rejected payment, full stop.
- **Server-side keys.** `SARVAM_API_KEY`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, the server Google Maps key and the Cloudinary/S3 credentials exist only in the server process. The app holds only `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SOCKET_URL`, `EXPO_PUBLIC_RAZORPAY_KEY_ID` and a separately restricted Maps SDK key.
- **KYC as an authorization gate, not a badge.** Unverified vehicles are excluded by the matching query itself, so no UI change or client tampering can surface them.
- **Socket rooms are scoped.** `join:request` / `join:trip` must verify that the authenticated user is a party to that request or trip before joining the room, otherwise room ids become an enumeration vector.
- **Uploads are URLs, not blobs.** KYC documents and proof-of-delivery photos go to Cloudinary/S3; Mongo stores only the resulting URL.

---

## 6. Explicitly NOT built at this stage

Recorded here so nobody re-adds them by accident:

- **No wallet or stored-value system, and no custom ledger.** Razorpay Route performs the split. `Payment` and `TransporterPayoutAccount` are the complete money record.
- **No multi-currency or international instruments.** INR only.
- **No card storage or tokenization.** Razorpay Checkout owns the instrument; we see order and payment ids only.
- **No admin dashboard.** KYC review is a protected API call an operator makes by hand.
- **No masked-number / VoIP proxy.** A `tel:` link is sufficient.
- **No polling fallback for real-time.** Socket.io plus Expo push covers both the foreground and background cases.
- **No React Query / Axios / Redux.** One `api.ts` helper over `fetch()`.
- **No automated refund after pickup.** Deliberately a human decision.
