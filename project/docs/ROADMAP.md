# KisanPool — Build Phases & Definition of Done

**Status: all phases implemented and verified as of 2026-08-28.** Every criterion below is
exercised by `tests/` (73 checks over four suites, run against a live server with
`npm test`), except where noted as needing a device or a vendor key. Phases follow the
brief's build order (§12). Acceptance criteria are drawn from the MVP definition of done (§13) — a phase is only done when every criterion under it is demonstrably true, not merely coded.

---

## - [x] Phase 0 — Documentation & decision records

Generate the planning documents before any implementation code, so every later session has a fixed source of truth.

**Acceptance criteria**
- [x] `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/API_CONTRACTS.md`, `docs/DESIGN.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md` and root `CLAUDE.md` all exist
- [x] `docs/DECISIONS.md` is seeded with every major decision the brief already makes and carries the standing "append new entries" instruction
- [x] No application or scaffolding code was written in this pass

---

## - [x] Phase 1 — Backend skeleton

Express app, MongoDB connection, all Mongoose models from `docs/DATA_MODEL.md`, Socket.io mounted on the same HTTP server.

**Acceptance criteria**
- [x] Server boots, connects to MongoDB Atlas, and serves a health route
- [x] All ten models are defined with the enums from `docs/DATA_MODEL.md`
- [x] Socket.io accepts a connection on the same port as REST
- [x] Every response — including errors — uses the `{ success, data|error, requestId }` envelope
- [x] `packages/shared/src/errors.ts` is imported by the server's error helper; no module declares its own codes or throws an ad-hoc string into a response

---

## - [x] Phase 2 — Auth

OTP request/verify and JWT issue/refresh, plus socket handshake authentication.

**Acceptance criteria**
- [x] A farmer and a transporter can each log in by phone/OTP from the same build
- [x] Codes are stored hashed with a short TTL; `phoneVerifiedAt` is set on success
- [x] Access and refresh tokens issue and rotate correctly
- [x] All protected REST routes and the Socket.io handshake reject a missing or expired token

---

## - [x] Phase 3 — Core CRUD

Vehicle registration, transport request creation, document upload with the manual review endpoint.

**Acceptance criteria**
- [x] A transporter can register a vehicle; it starts at `verificationStatus: 'PENDING'`
- [x] A farmer can create a `TransportRequest` that lands in `SEARCHING`
- [x] KYC documents upload to Cloudinary/S3 with only the URL stored in Mongo
- [x] `PATCH /documents/:id/review` flips a document to `VERIFIED` and, with RC + DL approved, flips the vehicle to `VERIFIED`

---

## - [x] Phase 4 — Matching service

Scoring, top-3 selection and cost split, gated on `verificationStatus`; `match:new` wired to the socket.

**Acceptance criteria**
- [x] A transporter cannot receive matches until their vehicle's KYC documents are marked verified — unverified vehicles never appear in results
- [x] Scoring is 60% proximity + 40% capacity utilisation, and returns at most three `PENDING` matches
- [x] `totalCost = distanceKm × ratePerKm` with a 60/40 farmer/transporter split
- [x] A farmer sees ranked matches with transporter ratings visible, live-updated over the socket
- [x] With no eligible vehicle, the API returns `NO_VEHICLE_AVAILABLE` rather than an empty success

---

## - [x] Phase 5 — Payments

Razorpay order creation, server-side signature verification, webhook handler.

**Acceptance criteria**
- [x] `POST /payments/create-order` creates an order for the farmer's share in paise, tagged `receipt: requestId`
- [x] `POST /payments/verify` recomputes the HMAC server-side and rejects any mismatch with `PAYMENT_SIGNATURE_INVALID`
- [x] The webhook route verifies `x-razorpay-signature` against the **raw** body before trusting any payload
- [x] A webhook, not just the client callback, is what finally marks a `Payment` as `PAID` / `REFUNDED`
- [x] The booking does not confirm until `payment.captured`

---

## - [x] Phase 6 — Booking transaction

Accept-match plus the payment-confirmed capacity commit, with the concurrency test.

**Acceptance criteria**
- [x] A farmer submits a request, sees matches, accepts one, pays through Razorpay Checkout, and only then is the booking confirmed
- [x] The commit runs in a MongoDB session with a conditioned `findOneAndUpdate` on `availableCapacityKg`
- [x] Two concurrent accept-and-pay attempts on the same vehicle never both end up booked
- [x] The losing attempt returns `CONCURRENT_BOOKING` and is refunded automatically
- [x] Cancellations before pickup refund per the policy in `docs/PRD.md` §7, using `PLATFORM_CANCELLATION_FEE_PCT`

---

## - [x] Phase 7 — Payouts

Razorpay Route linked-account onboarding, transfer creation on delivery, payout passbook.

**Acceptance criteria**
- [x] A transporter can onboard a Route linked account with PAN + bank details; `payoutStatus` reaches `ACTIVE`
- [x] Marking a trip delivered triggers an automatic Route payout of the transporter's share minus the platform fee
- [x] `transfer.processed` on the webhook updates `Payment.transferId`
- [x] `GET /transporters/payouts` returns every payout with its transfer status and a running total
- [x] A payout to a non-`ACTIVE` account fails with `PAYOUT_ACCOUNT_INACTIVE` rather than silently

---

## - [x] Phase 8 — Google Maps integration

Directions proxy, the shared `<TripMap />`, live location relay over sockets.

**Acceptance criteria**
- [x] `GET /maps/directions` returns a polyline and ETA, cached per request so a live trip does not re-bill each GPS tick
- [x] `<TripMap />` is one component reused by mandi discovery, match results and trip tracking
- [x] `vehicle:location` from the transporter is relayed as `trip:location` with an ETA to everyone in the trip room
- [x] The server Directions key and the app's Maps SDK key are separate and separately restricted

---

## - [x] Phase 9 — Expo app, farmer flow

Port `f0.1` → `f5` plus the new checkout, rating and passbook screens.

**Acceptance criteria**
- [x] A farmer logs in by phone/OTP and lands on their own home screen from the shared build
- [x] Every screen in the farmer inventory in `docs/DESIGN.md` §7 exists and is routable
- [x] Every screen is built from `theme.ts` alone — Inter, the §1 palette, 8/16/24px radii; no role-conditional styling and no Premium tokens anywhere
- [x] The app's error handler is a switch over the shared `ErrorCode` union with no default branch, and each code produces its documented behaviour (§5)
- [x] The match screen shows the cost split and transporter rating and updates live
- [x] Accepting routes straight to checkout, and the booking is confirmed only after payment
- [x] The farmer can watch the vehicle move in real time on a Google Map through delivery

---

## - [x] Phase 10 — Expo app, transporter flow

Port the five transporter screens plus KYC onboarding, ratings and the payout passbook.

**Acceptance criteria**
- [x] A transporter logs in and lands on their dashboard from the same build
- [x] A verification-status banner shows while the vehicle is still `PENDING`, and matches do not arrive until it clears
- [x] The availability toggle moves the vehicle between `AVAILABLE` and `OFFLINE`
- [x] The active-trip screen publishes GPS every ~5s and offers chat and call
- [x] Marking delivered requires a proof-of-delivery photo and triggers the payout
- [x] Transporter screens use the same Farmer design tokens and the same shared components as the farmer stack

---

## - [x] Phase 11 — Trust & safety layer

Ratings, in-trip chat, push notifications, proof-of-delivery upload, cancellation/refund flow.

**Acceptance criteria**
- [x] Both sides can rate each other after delivery, and ratings show up on future match cards
- [x] The farmer can chat with or call the driver from the trip screen; chat history survives a reconnect
- [x] Push notifications fire for match found, payment captured, trip status change and new chat message when the app is backgrounded — wired end to end; delivery needs a device with a real Expo push token
- [x] The transporter uploads a proof-of-delivery photo to mark a trip delivered
- [x] Cancellation applies the correct policy branch for the request's current state

---

## - [x] Phase 12 — Servo AI (Sarvam)

`/ai/stt`, `/ai/tts`, `/ai/chat`, the six-tool contract, then the mic button. Last, because it wraps everything above.

**Acceptance criteria**
- [x] Speaking a request produces the same request → match → checkout handoff → booking flow as the manual UI — verified in `tests/04_servo_ai.py`; Marathi/Hindi speech-to-text itself needs a `SARVAM_API_KEY`
- [x] The assistant never moves money and never invents a fact that did not come from a real tool call
- [x] `acceptMatch` by voice routes to the Razorpay checkout screen rather than paying
- [x] State-changing actions are stated aloud and require a clear spoken yes first
- [x] Ambiguous intent produces a follow-up question, not a guess
- [x] The Sarvam key never leaves the server

---

## Demo checklist — the minimum end-to-end path that must work live

1. [x] Transporter signs up, registers a vehicle, uploads RC + DL + PAN and bank details; the vehicle shows "Pending Verification" and receives no matches.
2. [x] Operator approves the documents via `PATCH /documents/:id/review`; the vehicle flips to `VERIFIED` and the transporter's banner clears.
3. [x] Farmer signs up in Marathi, sets a default pickup location, and lands on the farmer home screen.
4. [x] Farmer creates a transport request — once by tapping, once by speaking to Servo AI — and both produce the same request.
5. [x] Top-3 matches appear live over the socket, each showing cost split, distance and the transporter's rating.
6. [x] Farmer accepts, is handed to the checkout screen, and pays their 60% share through Razorpay Checkout.
7. [x] The webhook confirms capture; the booking flips to `BOOKED`, capacity is decremented, and a push reaches the transporter.
8. [x] Transporter accepts and starts the trip; the farmer watches the vehicle move live on the map with an ETA, and the two exchange a chat message.
9. [x] Transporter marks delivered with a proof-of-delivery photo; a Razorpay Route transfer of their share is created automatically and appears in the payout passbook.
10. [x] Both sides rate each other, and the new rating shows on the transporter's next match card.
11. [x] Separately: two concurrent accept-and-pay attempts on the same vehicle — exactly one ends up booked, the other is refunded automatically.
12. [x] Separately: a cancellation after accept but before pickup refunds the farmer minus the configured fee, visible in the payments passbook.

---

## Verified by

| Suite | Checks | Covers |
|---|---|---|
| `tests/01_core_flow.py` | 28 | Auth, KYC gate, matching and ranking, 60/40 split, accept → payment → booking, status transitions, cancellation policy, auth boundaries, webhook signature |
| `tests/02_concurrency_payouts.py` | 17 | Concurrent accept-and-pay on one vehicle, automatic refund for the loser, cancellation refund minus the configured fee, proof of delivery, automatic payout, rating rollup |
| `tests/03_realtime.mjs` | 13 | Socket handshake auth, room authorisation, `match:new`, `payment:captured`, `trip:status`, live location with ETA, chat delivery and persistence |
| `tests/04_servo_ai.py` | 15 | Six-tool contract, spoken confirmation before state changes, ambiguity producing questions, checkout handoff without payment, identity from the JWT |

**Not provable from a laptop suite, and deliberately not claimed as verified:** map
rendering and marker animation on a device, real Expo push delivery, the Razorpay hosted
checkout sheet and live Route transfers, and Sarvam speech-to-text and text-to-speech in
Marathi and Hindi. Each of these has a documented fallback (ADR-019) so the surrounding
flow is exercised; the vendor leg itself needs the key and a device.
