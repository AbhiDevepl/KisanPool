# KisanPool — API & Event Reference

Every REST route except `POST /webhooks/razorpay` requires a valid JWT access token in `Authorization: Bearer <token>`. The webhook is authenticated by Razorpay's signature instead.

---

## 1. Response envelope

Every response — success or failure — uses one shape:

```json
{ "success": true, "data": { }, "requestId": "req_123" }
```

```json
{ "success": false, "error": { "code": "NO_VEHICLE_AVAILABLE", "message": "..." }, "requestId": "req_123" }
```

`lib/api.ts` on the client throws whenever `success` is `false`, so callers only ever handle `data`.

---

## 2. REST endpoints

### Auth (`modules/auth`) — unauthenticated

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/auth/request-otp` | `{ phone }` | `{ sent: true }` — 6-digit code, hashed with a short TTL |
| POST | `/auth/verify-otp` | `{ phone, code }` | `{ accessToken, refreshToken, user }`; sets `phoneVerifiedAt` |
| POST | `/auth/refresh` | `{ refreshToken }` | `{ accessToken, refreshToken }` — standard rotate |

### Users (`modules/users`)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/users/me` | — | The `User` document for the token's subject |
| PATCH | `/users/me` | `{ pushToken?, language?, name?, defaultLocation? }` | Updated `User`. This is where the Expo push token is registered on login |

### Vehicles (`modules/vehicles`)

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/vehicles` | `{ vehicleType, capacityKg, ratePerKm, currentLocation }` | Created/updated `Vehicle`, starting at `verificationStatus: 'PENDING'` |
| PATCH | `/vehicles/:id/availability` | `{ status }` — `AVAILABLE \| BUSY \| OFFLINE` | Updated `Vehicle`. Backs the dashboard availability toggle |

### Documents / KYC (`modules/documents`)

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/documents` | multipart: file + `{ type }` (`RC \| DL \| AADHAAR \| PAN`) | Created `Document` in `PENDING`; file stored in Cloudinary/S3 |
| GET | `/documents/me` | — | The caller's documents and their statuses |
| PATCH | `/documents/:id/review` | `{ status }` | **Internal/admin.** Approves or rejects; approving RC + DL is what flips the vehicle to `VERIFIED`. API-only in the MVP — there is no admin UI |

### Transport (`modules/transport`)

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/transport/requests` | `{ cropType, quantityKg, pickup, destination, preferredDate }` | Created `TransportRequest`; triggers a matching run |
| GET | `/transport/requests/:id` | — | `{ request, vehicle, match, counterparty }` — the accepted match (for the real cost split) and the other party's name/phone (so the in-trip Call button can dial). Only the *other* party, only to someone already proved to be on this trip |
| GET | `/transport/requests/:id/matches` | — | Top 3 ranked vehicles, each with `score`, `distanceKm`, `totalCost`, `farmerShare`, `transporterShare` and the owner's `ratingAvg` |
| POST | `/transport/requests/:id/accept` | `{ vehicleId }` | Creates a `Payment` in `CREATED`; request → `PAYMENT_PENDING`. **Does not confirm the booking** |
| PATCH | `/transport/requests/:id/status` | `{ status }` — `PICKED_UP \| IN_TRANSIT \| DELIVERED` | Updated request; emits `trip:status` and fires a push |
| POST | `/transport/requests/:id/cancel` | `{ reason }` | Applies the cancellation policy (PRD §7) and refunds where applicable |
| POST | `/transport/requests/:id/pod` | multipart image | Proof-of-delivery photo URL stored on the request; transporter only, on `DELIVERED` |

### Payments (`modules/payments`)

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/payments/create-order` | `{ shipmentId }` | `{ razorpayOrderId, amount, currency, keyId, demo }` — amount in **integer paise**, `receipt` is the Payment id. The amount is the pricing engine's frozen figure; a client-supplied amount is ignored. **Idempotent**: the same shipment returns the same order. When the driver's linked account is live, the transporter's share is attached as a Route `transfers[]` entry so Razorpay settles it on capture (ADR-043) |
| POST | `/payments/verify` | `{ razorpay_order_id, razorpay_payment_id, razorpay_signature }` | Verified payment. Server recomputes `HMAC_SHA256(orderId\|paymentId, RAZORPAY_KEY_SECRET)` and rejects on mismatch. The webhook is still what finally settles state (ADR-012) |
| POST | `/payments/refund` | `{ paymentId, reason }` | Razorpay refund for the policy amount. If a transfer has already been **processed**, the transfer is reversed first (`POST /v1/transfers/:id/reversals`) and the payout becomes `REVERSED` — a refund after payout is no longer simply refused (ADR-043) |
| POST | `/webhooks/razorpay` | raw body | **No JWT.** Verifies `x-razorpay-signature` as an HMAC of the raw body with `RAZORPAY_WEBHOOK_SECRET`. **Idempotent**: each delivery is claimed by inserting its `x-razorpay-event-id` into a uniquely-indexed store, so a Razorpay retry is acknowledged and dropped. Handles `payment.captured` (recording Razorpay's `fee`/`tax`), `payment.failed`, `transfer.processed`, `transfer.failed`, `settlement.processed`, `refund.created`/`refund.processed`. This is the source of truth for reconciliation |

### Transporters / payouts (`modules/payments`)

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/transporters/payout-onboarding` | `{ panNumber, bankAccountNumber, ifsc, name? }` | Creates a Razorpay **Route linked account** (not a customer) and stores the `acc_…` id plus its creation time. Starts `PENDING`, never `ACTIVE`: Razorpay must verify the bank account and a **24-hour cooling period** applies before the account can receive a transfer (ADR-043) |
| GET | `/transporters/payouts` | — | Payout passbook: each row's gross share, `payoutState`, `payoutNote` (why it has not settled), `transferId`, `settledAt`; plus `total` (actually settled), `pendingTotal`, `failedCount` and `eligibility` |

### Money: the split, and what is not ours (ADR-043)

The pooled pricing engine (ADR-035) alone decides what a farmer owes. Payments only move that decided number:

```
priceTrip → shipment.finalPrice → splitPaise(amountPaise, PLATFORM_FEE_PCT)
          → Razorpay order (+ Route transfers[]) → capture → transfer → webhooks
```

- **One commission source.** `PLATFORM_FEE_PCT` (default 10), read through `lib/money.ts#commissionRate()` by pooled transport, machinery and backhaul. `PLATFORM_COMMISSION_PCT` in shared is now only its documented default.
- **Exact in paise.** `platformFeePaise = round(amountPaise × pct / 100)`; the transporter gets the **remainder**, so the parts always sum to the whole. ₹1,000 at 15% → ₹150 + ₹850.
- **Pooling stays fair.** Every farmer on a shared trip is charged the same rate on their own share, so the driver's pooled total is the trip total less that one rate.
- **Four different "fees", kept apart.** Customer payment · KisanPool commission · transporter gross share · **Razorpay's own** gateway fee (on the whole capture) and Route transfer fee (per transfer), both plus GST and both borne by the platform account. Razorpay's fees are recorded **only when Razorpay reports them**; `netPlatformPaise` is `null` until then and is never estimated.
- **Settlement of the platform's own balance** is Razorpay's normal settlement cycle. Nothing in application code moves the retained amount to a bank account.
- **Payment state ≠ payout state.** `Payment.status` is the farmer's money arriving; `Payment.payoutState` (`PENDING → CREATED → PROCESSED`, plus `FAILED`, `REVERSED`, `NOT_APPLICABLE`) is the driver's money leaving. A failed payout never re-charges the farmer, and a failed payment never settles a payout.

**Environment** — all names already existed; no new variable is required:
`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `PLATFORM_FEE_PCT`, `PLATFORM_CANCELLATION_FEE_PCT`. Route uses the standard API key pair — there is no separate Route access token. With `RAZORPAY_KEY_ID`/`_SECRET` blank the app runs in **demo mode**: ids are prefixed `order_demo_` / `trf_demo_` / `rfnd_demo_` / `rvrsl_demo_` so nothing can be mistaken for money that moved.

### Ratings (`modules/ratings`)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/trips/:id/ratings` | — | Ratings recorded for that trip |
| POST | `/trips/:id/ratings` | `{ stars, comment }` | Created `Rating`; recomputes the subject's `ratingAvg` / `ratingCount` |

### AI (`modules/ai`)

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/ai/stt` | multipart audio | `{ transcript, language }` — Sarvam `saaras:v3`, mode `transcribe` |
| POST | `/ai/tts` | `{ text, language }` | `{ audio }` base64 — Sarvam `bulbul:v3` |
| POST | `/ai/chat` | `{ message, sessionId }` | `{ reply, language, action, data }` — Servo AI entry point |

### Admin (`modules/admin`) — operator console

Authenticated by the `admin: true` JWT claim, never by a `User.role`. `requireAdmin`
rejects a marketplace token with `AUTH_FORBIDDEN`.

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/admin/login` | `{ username, password }` | `{ token, usingDefaultCredentials }` — 12-hour operator token |
| GET | `/admin/stats` | — | Platform totals: users by role, vehicles by status and verification, trips by status, tonnes moved, money collected/paid out/refunded, ratings, documents pending |
| GET | `/admin/users` | `?q=&role=` | Users with their vehicle, trip counts and rating. Never returns `pushToken` or OTP fields |
| GET | `/admin/documents` | `?status=` | KYC grouped **by transporter**, each with their vehicle and every document |
| PATCH | `/admin/documents/:id` | `{ status, reason? }` | Reviews one document, then reconciles the vehicle's `verificationStatus` |
| GET | `/admin/vehicles` | — | Every vehicle with owner, capacity, last reported location and its active trip |
| PATCH | `/admin/vehicles/:id` | `{ status?, verificationStatus?, currentLocation? }` | Updates a vehicle. Setting `AVAILABLE` on an unverified vehicle fails with `KYC_PENDING_REVIEW` |
| GET | `/admin/payouts` | — | Route linked-account state per transporter |
| GET | `/admin/billing` | `?status=&tripId=` | Settlements per shipment, each with a `settlement` block: amount / commission / transporter share in paise, Razorpay's gateway and transfer fees where reported, `netPlatformPaise` (null while unknown), `payoutState`, `transferId`, refund and reversal ids (ADR-043) |
| POST | `/admin/payments/:id/retry-payout` | — | Re-attempt one stuck Route transfer (`PENDING` or `FAILED`). Refuses to act on a payment that already carries a `transferId`, so a retry can never double-pay, and never touches the farmer's payment |

`PATCH /documents/:id/review` (the original operator route) also requires the admin claim.

### Predictive Insights (`modules/predictions`) — advisory, read-only (ADR-041)

Deterministic risk scoring over signals the app already records. **Nothing here writes, and nothing here can act on a trip, price, route or transporter** — see §9. Every response carries `reasons` (plain language, each tied to a signal that fired), the raw `signals`, and a `confidence` that is `LOW` when the inputs were too thin to trust the level.

| Method | Path | Body / Query | Returns | Auth |
|---|---|---|---|---|
| GET | `/predictions/trips/:id` | — | `{ tripId, tripState, delay: RiskAssessment, cancellation?: RiskAssessment }`. `cancellation` is returned **only to the trip's transporter**; a farmer aboard gets `delay` alone | trip party |
| GET | `/predictions/demand` | — | `DemandAssessment[]` — one per mandi/corridor with recent activity, most in-demand first | any signed-in user |
| GET | `/predictions/ops` | — | `{ generatedAt, trips: [...delay + cancellation per live trip], demand: DemandAssessment[] }` | `requireAdmin` |
| POST | `/predictions/simulate` | `{ kind: 'DELIVERY_DELAY'\|'CANCELLATION'\|'DEMAND', signals }` | Runs the pure engine on the supplied signals — no database read. Pins engine behaviour in tests | `requireAdmin` |

`RiskAssessment` = `{ kind, level: LOW|MEDIUM|HIGH, score 0–100, reasons[], signals{}, confidence, computedAt }`. `DemandAssessment` uses `level: NORMAL|MEDIUM|HIGH`. Thresholds live once in `packages/shared/src/predictions.ts`.

### Maps (`modules/maps`)

| Method | Path | Query | Returns |
|---|---|---|---|
| GET | `/maps/directions` | `origin`, `destination` | Google Directions polyline + ETA, cached per request so a live trip doesn't re-bill on every GPS tick |
| GET | `/maps/places` | `q` (≥2 chars), `near?` (`lat,lng`) | `[{ name, lat, lng, source }]` — resolves a typed place to coordinates so a farmer can NAME a pickup instead of being pinned to device GPS (ADR-042). Google Geocoding when a key is set, else an offline gazetteer (`maps/places.ts`); `source` says which |

### V2 additions (ADR-042)

| Method | Path | Body / Query | Returns | Auth |
|---|---|---|---|---|
| GET | `/pool/trips/:id/track` | — | `{ trackable, reason?, origin, destination, lastSeenAt, stale, staleMinutes, directionsUrl }` — the Live Track hand-off: transporter's latest position + destination mandi + a Google Maps directions deep link. `trackable` is business-state driven (not a timer): false while FORMING, false once the viewer's own load is DELIVERED+, false when COMPLETED/CANCELLED. Pooled trips share one stream. The URL carries only coordinates — no JWT, no ids | trip party |
| GET | `/farm/machines/:id/grouping` | `lat`, `lng`, `start`, `end`, `areaAcres?` | `GroupingAssessmentDTO` — could this hire share a provider outing (and its travel cost) with not-yet-started jobs already booked nearby? `compatibility` NONE\|LOW\|MEDIUM\|HIGH, `reasons[]`, `soloTravelCost` / `sharedTravelCost` / `projectedSaving`. Advisory — never forces a grouping | any signed-in user |
| POST | `/farm/bookings/group` | `{ bookingIds: string[] }` (≥2) | `{ groupId, shareCount, bookings }` — group not-yet-started bookings on ONE of the provider's machines so their round-trip travel splits across them. Only travel splits; work cost never does. Refused when the jobs are not actually near/soon | machine owner |

Machinery quotes now carry `travelShareCount` (1 = solo, unchanged; >1 = travel is this farmer's share of a shared outing). `MachineBookingDTO` carries `groupId?` and a `group` summary (`size`, `combinedTotal`, `combinedProviderEarning`, window span). A strongly compatible new `REQUESTED` booking auto-joins a nearby cluster and re-quotes its not-yet-started members. Provider onboarding: role selection has a third "Machinery / service provider" card that creates a FARMER account (ADR-038) and routes to `machine-register`.

---

## 3. Socket.io events

Handshake carries the same JWT as REST (`auth: { token }`). Rooms are `requestId` / `tripId` strings; joining is only permitted for a party to that request or trip.

### Client → server

| Event | Payload | Sent from |
|---|---|---|
| `join:request` | `{ requestId }` | `(farmer)/requests/[id]/matches` — subscribing to live match offers |
| `join:trip` | `{ tripId }` | `(farmer)/trips/[id]` and `(transporter)/trips/[id]` — tracking and chat |
| `vehicle:location` | `{ tripId, lat, lng }` | `(transporter)/trips/[id]`, published every ~5s during an active trip |
| `chat:send` | `{ tripId, text }` | The chat sheet on either side's active-trip screen |

### Server → client

| Event | Payload | Consumed by |
|---|---|---|
| `match:new` | `{ requestId, match }` | Match list, which re-ranks live as offers arrive |
| `trip:status` | `{ tripId, status, at }` | Both active-trip screens and the farmer's tracking stepper |
| `trip:location` | `{ tripId, lat, lng, etaMinutes }` | The farmer's live map — moves the vehicle marker and updates the ETA |
| `trip:pricing_updated` | `{ tripId, pricingVersion, reason, updates[], pricing?: TripPricingDTO }` | Both active-trip screens. `pricing` carries the whole re-priced trip so the headline share, the trip total and every other farmer's row update in place without a refetch (ADR-040); `updates[]` remains for the "your cost dropped" nudge |
| `trip:prediction` | `{ tripId, delay: RiskAssessment }` | Both active-trip screens and the admin Live board. Pushed **only when the delay level changes** after a GPS ping, never on every ping (ADR-041) |
| `payment:captured` | `{ requestId, paymentId }` | Checkout screen, which advances to the confirmed booking once the webhook lands |
| `chat:message` | `{ tripId, senderId, text, ts }` | Chat sheet on both sides |

---

## 4. AI-safe tool contract

Servo AI may call exactly these six tools. **Each one calls the same service function the corresponding REST route calls** — there is no separate, looser code path into the domain, and every validation a human tap triggers also runs here.

```js
getUserProfile()
findMatchingVehicles({ pickupLocation, destination, cropType, quantityKg, preferredDate })
createTransportRequest({ cropType, quantityKg, pickupLocation, destination, preferredDate })
acceptMatch({ requestId, vehicleId })   // hands off to the checkout screen — does NOT pay
getTripStatus({ requestId })
cancelRequest({ requestId, reason })
```

Rules that bind these tools:

- The authenticated user id comes from the JWT, **never** from speech.
- The LLM never writes to MongoDB directly and never invents a price, vehicle, ETA or booking id — every fact it states must have come back from one of these calls.
- **`acceptMatch` does not complete payment.** It creates the order state and returns a navigation action; the farmer still completes the actual payment on the Razorpay checkout screen. The assistant never initiates or confirms a payment.
- State-changing tools (`createTransportRequest`, `acceptMatch`, `cancelRequest`) require the assistant to state what it is about to do and receive a clear spoken yes first.
- Ambiguous intent produces a follow-up question, not a guess.

---

## 5. Error codes

**Exactly 25 codes. This list is closed** — do not add a 26th, and do not emit an ad-hoc string at a call site. If something genuinely doesn't fit, the fix is an ADR that changes this table, not a new literal in a service file. All codes are `SCREAMING_SNAKE_CASE` and stable once shipped.

The same 25 are used by the backend REST layer, by Socket.io error payloads, and by the mobile app's error handling. They are defined once in `packages/shared/src/errors.ts` and imported by both sides — neither the server nor the app declares its own copy.

### Authentication (4)

| Code | HTTP | Meaning | Client behaviour |
|---|---|---|---|
| `AUTH_UNAUTHENTICATED` | 401 | Missing, malformed or expired access token | Attempt one silent refresh with the refresh token; on a second failure, clear secure storage and redirect to `(auth)/welcome` |
| `AUTH_FORBIDDEN` | 403 | Authenticated, but not a party to this request, trip or vehicle | Show "You don't have access to this trip", redirect to the role's home. No retry |
| `AUTH_OTP_INVALID` | 400 | OTP wrong or expired | Show the message inline under the OTP field, clear the input, keep the user on `(auth)/verify` |
| `AUTH_RATE_LIMITED` | 429 | Too many OTP requests for that phone | Disable "Resend OTP" and show a countdown until it may be retried |

### KYC (3)

| Code | HTTP | Meaning | Client behaviour |
|---|---|---|---|
| `KYC_REQUIRED` | 403 | The action needs verified KYC that was never submitted — an unverified vehicle trying to accept, or a payout with no documents on file | Redirect to `(auth)/kyc` with an explanation of what's missing |
| `KYC_PENDING_REVIEW` | 403 | Documents are submitted and awaiting review; the vehicle is still `PENDING` | Show the dashboard's verification banner, disable the availability toggle and accept buttons. No retry — the user waits |
| `KYC_DOCUMENT_REJECTED` | 403 | A document was reviewed and rejected | Route to `(auth)/kyc` with the rejected document highlighted for re-upload |

### Payments (6)

| Code | HTTP | Meaning | Client behaviour |
|---|---|---|---|
| `PAYMENT_FAILED` | 402 | The payment did not succeed — checkout failure, `payment.failed` webhook, or order creation rejected by Razorpay | Stay on checkout, show "Payment didn't go through", offer "Try again" without re-accepting the match |
| `PAYMENT_SIGNATURE_INVALID` | 400 | An HMAC signature failed server-side verification — either the checkout triple on `/payments/verify` or `x-razorpay-signature` on the webhook | Never retry automatically. Show a support-contact message on the client; log and alert on the server |
| `PAYMENT_NOT_CAPTURED` | 409 | Capture hasn't landed yet — a booking commit was attempted, or the client is polling ahead of the webhook | Hold the "Confirming your booking…" state and wait for `payment:captured`; bounded retry with backoff, then offer manual refresh |
| `PAYMENT_REFUND_NOT_ALLOWED` | 409 | Refund attempted after pickup, or after a Route transfer already went out for that payment | Show the cancellation policy and a "Contact support" action. Disable the refund button. No retry |
| `PAYOUT_ACCOUNT_INACTIVE` | 403 | The transporter has no Route linked account in `ACTIVE` | Route to the payout-onboarding step; disable the payouts screen's actions until resolved |
| `PAYOUT_TRANSFER_FAILED` | 502 | Razorpay Route transfer creation or processing failed | Show the payout as "Payout pending" in the passbook, not as an error the driver must fix. Server retries; the trip stays delivered |

### Concurrency (2)

| Code | HTTP | Meaning | Client behaviour |
|---|---|---|---|
| `CAPACITY_EXCEEDED` | 409 | The vehicle no longer has enough `availableCapacityKg` for this quantity | Explain the vehicle filled up, return to the match list, refresh matches. No blind retry against the same vehicle |
| `CONCURRENT_BOOKING` | 409 | Lost the booking race — the conditioned `findOneAndUpdate` in the capacity commit did not match. The payment is refunded automatically | Show plainly that the vehicle was taken **and that the refund is already in progress**, then return to the match list. Never a generic error — this one costs the user real money |

### Transport (3)

| Code | HTTP | Meaning | Client behaviour |
|---|---|---|---|
| `NO_VEHICLE_AVAILABLE` | 404 | Matching found no verified, available vehicle with enough spare capacity | Show the empty state with "We'll notify you when a vehicle is free"; keep the socket joined so a later `match:new` still lands |
| `MATCH_EXPIRED` | 409 | The offered match is no longer `PENDING` | Remove that card, refresh the match list, prompt the farmer to pick another |
| `POD_REQUIRED` | 400 | Delivery was marked without a proof-of-delivery photo | Keep the transporter on the completion screen with the photo control highlighted; disable "Mark Delivered" until a photo is attached |

### Booking (2)

| Code | HTTP | Meaning | Client behaviour |
|---|---|---|---|
| `BOOKING_STATE_INVALID` | 409 | The transition isn't legal from the request's current status — a duplicate accept, an open payment already existing, a status jump, or acting on a cancelled request | Refetch the request and re-render from its true status. No retry of the same call |
| `BOOKING_ALREADY_RATED` | 409 | This user already rated this trip | Show the existing rating read-only and disable the submit button |

### AI (2)

| Code | HTTP | Meaning | Client behaviour |
|---|---|---|---|
| `AI_INTENT_UNCLEAR` | 200 with `success:false` | The assistant could not resolve intent and is asking a follow-up rather than guessing | Not an error state in the UI — speak and display the follow-up question and keep the session open for the next utterance |
| `AI_TOOL_ERROR` | 502 | A tool call failed, or the model attempted something outside the six-tool contract | Say "I couldn't do that — please try on screen", close the voice session cleanly, and leave the user on a usable screen. Never fabricate a result |

### Cross-cutting (3)

| Code | HTTP | Meaning | Client behaviour |
|---|---|---|---|
| `VALIDATION_ERROR` | 400 | Request body or params failed schema validation | Map to the offending field and show it inline; keep the form filled |
| `RESOURCE_NOT_FOUND` | 404 | No such request, trip, vehicle, document, match or user | Show a not-found state and route back to the role's home. No retry |
| `EXTERNAL_SERVICE_ERROR` | 502 | An upstream we depend on failed in a way we cannot map to a domain code — Cloudinary/S3 upload, Google Directions, Sarvam STT/TTS transport | Retry once with backoff, then degrade: the map falls back to markers without a polyline, an upload offers "Try again". Never block the trip on it |

### Rules

1. **One definition.** `packages/shared/src/errors.ts` exports the `ErrorCode` union, the HTTP status map and the client handling strategy. The server imports it for its error helper; the app imports it for its handler. Neither redeclares a code.
2. **Envelope always.** Every failure — REST, webhook, socket — is `{ success: false, error: { code, message }, requestId }` (§1). The `code` is what the client branches on; `message` is human-readable and may be localised, never parsed.
3. **Socket errors use the same shape.** A failed `join:request`, `join:trip`, `chat:send` or `vehicle:location` emits an `error` event carrying the same envelope and the same codes.
4. **No ad-hoc strings.** No `throw new Error('vehicle busy')` reaching a response, no HTTP status used as the sole signal, no per-module code prefixes.
5. **Upstream failures map to the domain code of the operation.** A Razorpay order failure is `PAYMENT_FAILED`, a transfer failure is `PAYOUT_TRANSFER_FAILED`, a Sarvam failure inside a tool call is `AI_TOOL_ERROR`. `EXTERNAL_SERVICE_ERROR` is only for upstream failures with no domain meaning.
6. **Deterministic handling.** Every code above has exactly one client behaviour — show, retry, redirect or disable. The app's error handler is a switch over the union with no default branch, so adding a code without handling it fails the type check.

---

## 6. Predictive Insights — trust boundary (ADR-041)

Predictions are **advisory**. They are computed read-only from real application signals, they arrive with the reasons behind them, and they never act:

- No prediction cancels a trip, changes a price, reroutes a vehicle, rejects a transporter or blocks a farmer. There is no code path from `modules/predictions` into a domain write.
- The deterministic engine (`priceTrip`, capacity, state machines) stays authoritative. A prediction that disagrees with it loses.
- Scoring is deterministic: the same signals produce the same level and reasons every run. Verified in `tests/09_predictions.py`.
- The feature is labelled "Predictive Insights" / "AI Risk Prediction" because it genuinely runs on application data and stated rules — it is **not** a trained model and no screen claims it is. The scoring lives behind `assess*` service functions so a model can replace the arithmetic later without a route or screen change.
- Visibility: a farmer sees delivery-delay risk on their active trip only; the transporter also sees cancellation risk on theirs; the operator sees the full roll-up at `/predictions/ops`.
