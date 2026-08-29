# KisanPool — Product Requirements Document

Source of truth: `prompt/KisanPool_MVP_Build_Prompt.md`. This document reorganizes that brief into product terms. It does not add scope beyond it.

---

## 1. Problem statement

Small and marginal farmers in India routinely need to move a few quintals of produce from their field to a mandi, but the vehicles that make that trip are sized for full loads. A farmer either pays for a whole truck they only half-fill, or waits for a neighbour to co-ordinate a shared trip by phone. Meanwhile transporters drive half-empty vehicles and return completely empty. KisanPool matches a farmer's transport request to a nearby verified vehicle that has spare capacity, splits the cost across that trip, settles it digitally, and tracks it live — so a small load becomes economically viable to move.

---

## 2. Users & personas

### Farmer — "Sunil", 34, 2.5 acres near Nashik
Sunil harvests 400–900 kg of onion or tomato at a time and needs it at the mandi the same or next morning. Today he calls two or three vehicle owners he knows, accepts whatever rate is quoted, pays cash with no record, and has no way to know where his produce is once it leaves the field. He reads slowly and prefers Marathi. **Success for Sunil:** he states what he has and where it must go — by tapping or by speaking Marathi to Servo AI — sees an upfront cost before committing, pays his share by UPI, and watches the vehicle move on a map until delivery.

### Transporter — "Ramesh", 41, owns one 3-tonne mini-truck
Ramesh's vehicle is booked maybe three days a week and often runs at 50–60% of capacity, with the return leg empty. He wants more paying load on trips he is already making, and he wants to be paid reliably without chasing anyone for cash. **Success for Ramesh:** he goes online, sees matched requests along routes he already runs, accepts with one tap, drives, uploads a delivery photo, and sees his share land in his bank account automatically with a visible record of every payout.

---

## 3. Goals & success metrics (MVP)

| Goal | Metric | MVP target |
|---|---|---|
| Matching actually works | Time from request submitted to first `match:new` delivered | < 5 seconds |
| Matches are usable | % of requests that surface at least one verified vehicle | ≥ 80% in a seeded demo region |
| Payment is reliable | Razorpay checkout success rate (captured / attempted) | ≥ 90% |
| Bookings are correct | Double-booked vehicles under concurrent accepts | 0 (hard requirement) |
| Trips complete cleanly | % of trips reaching `DELIVERED` with a proof-of-delivery photo and no manual intervention | ≥ 90% |
| Payouts land | % of delivered trips with a Razorpay Route transfer in `processed` state | ≥ 95% |
| Trust signal accrues | % of delivered trips rated by at least one side | ≥ 50% |
| Voice is real, not a toy | % of voice sessions that reach a created `TransportRequest` without a fabricated fact | ≥ 70% |
| Repeat usage | Farmers creating a second request within the demo period | Directional only — tracked, not gated |

---

## 4. In-scope for this MVP

- **One Expo app, two roles.** `User.role` is set once at onboarding; `(farmer)` and `(transporter)` route groups mount from the same build after login.
- **Phone + OTP auth** issuing JWT access + refresh tokens.
- **Farmer request creation** — crop type, quantity, pickup, destination, preferred date, with Google Places pickup/destination selection.
- **Mandi discovery** — nearby mandis on a Google Map plus a list, with a detail screen and a "Ship here" action.
- **Deterministic matching** — 60% proximity + 40% capacity utilisation, top 3 results, delivered live over Socket.io.
- **Upfront cost estimation and cost split** — `totalCost = distanceKm × ratePerKm`, farmer 60% / transporter 40%, shown before the farmer commits.
- **Razorpay payment** — the farmer pays their share through Razorpay Checkout; the booking is confirmed only after capture is verified server-side.
- **Razorpay Route payouts** — the transporter's share transfers to their linked account when the trip is marked delivered.
- **KYC gating** — RC + DL (plus PAN and bank details for payouts) must be reviewed before a vehicle appears in matching at all.
- **Live tracking** — transporter's GPS relayed over the socket every ~5s, rendered on a shared `<TripMap />` with route polyline and ETA.
- **In-trip chat and call** — socket-backed message list per trip, plus a plain `tel:` call button.
- **Push notifications** — match found, payment captured, trip status changed, new chat message.
- **Proof of delivery** — one photo uploaded by the transporter when marking delivered.
- **Ratings** — 1–5 stars plus optional comment, both directions, rolled into `User.ratingAvg` and shown on match cards.
- **Cancellation & refunds** — the policy in §7 below, enforced in code with a configurable fee percentage.
- **Passbooks** — farmer payment history with receipts and refund status; transporter payout history with transfer status and running total.
- **Servo AI voice assistant** — Sarvam STT → chat → TTS, in the farmer's own Indian language, restricted to six read/write-safe tools.
- **Digital receipt** — a per-trip receipt showing crop, weight, route, cost split, and payment ID.

---

## 5. Explicitly out of scope for this MVP

- **Multi-role accounts.** One role per account. A farmer who also drives creates a second account later.
- **Wallet / stored value / custom ledger.** Razorpay Route performs the split; the `Payment` and `TransporterPayoutAccount` records are the only money records we keep.
- **Full GST invoicing.** The receipt is a trust signal in GST-invoice *style*; no GST registration or filing is implied.
- **International payments and multi-currency.** INR only.
- **Card storage or tokenization.** Razorpay Checkout owns the payment instrument; we only ever see order and payment IDs.
- **Admin dashboard UI.** KYC review is a manual, API-only action (`PATCH /documents/:id/review`) performed by an operator during the demo. There is no admin front-end in this MVP.
- **Masked-number / VoIP call proxy.** A direct `tel:` link is enough at this stage.
- **Automated refunds after pickup.** Handled by a human, deliberately.

---

## 6. User stories

### Farmer

- As a farmer, I want to pick my language on first launch, so that the app and the voice assistant speak to me in Marathi or Hindi rather than English.
- As a farmer, I want to sign in with just my phone number and an OTP, so that I don't need an email address or a password.
- As a farmer, I want to enter my name and default pickup location once, so that I don't re-type my village on every request.
- As a farmer, I want to create a transport request with crop, weight, pickup, destination and date, so that the system can find me a vehicle.
- As a farmer, I want to browse nearby mandis with prices and distance, so that I can decide where it's worth sending my produce.
- As a farmer, I want to see the top matching vehicles with their cost, distance and the transporter's rating, so that I can choose on price and trust, not guesswork.
- As a farmer, I want the match list to update itself while I'm looking at it, so that I see a better vehicle the moment it becomes available.
- As a farmer, I want to see my exact share of the cost before I commit, so that there is no surprise at the end of the trip.
- As a farmer, I want to pay my share by UPI or card through Razorpay, so that the booking is confirmed without handing cash to a driver.
- As a farmer, I want to watch the vehicle move on a live map with an ETA, so that I know when my produce will reach the mandi.
- As a farmer, I want to chat with or call the driver from inside the trip screen, so that I can give directions without exchanging numbers first.
- As a farmer, I want push notifications for match found, payment captured and each status change, so that I'm informed even with the app closed.
- As a farmer, I want to cancel before pickup and get my money back minus a stated fee, so that a change of plan doesn't cost me the whole fare.
- As a farmer, I want to rate the transporter after delivery, so that other farmers benefit from my experience.
- As a farmer, I want a passbook of every payment, receipt and refund, so that I have a record of what I paid and when.
- As a farmer, I want to speak my whole request in Marathi to Servo AI and be handed to the payment screen, so that I can book without reading the interface.

### Transporter

- As a transporter, I want to register my vehicle with its type and capacity, so that I only get shown loads I can actually carry.
- As a transporter, I want to upload my RC, DL, PAN and bank details in a guided flow, so that I become eligible to accept loads and be paid out.
- As a transporter, I want to see clearly that my vehicle is still pending verification, so that I know why I'm not receiving matches yet.
- As a transporter, I want an availability toggle, so that I stop receiving matches when the vehicle is off the road.
- As a transporter, I want to see available matched requests with a mini-map, so that I can judge the detour before accepting.
- As a transporter, I want to accept or reject a request with a reason, so that rejecting doesn't count against me unfairly.
- As a transporter, I want to update trip status and have my GPS published automatically, so that the farmer stops calling me for updates.
- As a transporter, I want to chat with or call the farmer, so that I can find the pickup point.
- As a transporter, I want to mark delivery with a photo, so that there's proof and my payout is released.
- As a transporter, I want my share transferred to my bank account automatically on delivery, so that I never have to chase payment.
- As a transporter, I want an earnings passbook with each payout's transfer status and a running total, so that I can reconcile my week.
- As a transporter, I want to rate the farmer after delivery, so that reliability runs both ways.

---

## 7. Cancellation & refund policy

| When cancelled | Farmer's payment | Notes |
|---|---|---|
| Before a match is accepted | N/A — no payment taken yet | The `TransportRequest` is simply cancelled |
| After accept, before pickup | Full refund minus a platform cancellation fee (default 5%) | Razorpay Refunds API; the vehicle's capacity is released back |
| After pickup | No refund by default | Trip is already in motion; support can override manually. Not automated |

The fee percentage is configuration (`PLATFORM_CANCELLATION_FEE_PCT`), never a hardcoded literal.

---

## 8. Non-goals & explicit constraints

- **India-only, INR-only.** No currency conversion, no non-Indian payment instruments.
- **Phone-based auth only.** No email/password, no social login.
- **One role per account** for the entire MVP.
- **The AI never decides anything.** It never writes to MongoDB, never invents a price, vehicle, ETA or booking ID, and never initiates or confirms a payment — accepting a match by voice still routes the farmer to the Razorpay checkout screen.
- **No payment is ever trusted from the client alone.** Server-side signature verification plus the Razorpay webhook are what mark a payment `PAID`.
- **KYC-unverified vehicles never appear in matching.** This is a filter in the matching query, not a UI-level hint.
- **Hackathon-scale infrastructure.** A single Express process with Socket.io and MongoDB Atlas free tier; no queue, no Redis, no microservices.
