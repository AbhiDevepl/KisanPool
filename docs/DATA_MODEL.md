# KisanPool — Data Model Reference

MongoDB + Mongoose. Enums are plain Mongoose string unions — no separate validation package at this scale. Every document carries `_id`; `createdAt`/`updatedAt` come from `{ timestamps: true }` where both are listed.

---

## User

The account. One role per account for the MVP — the role decides which navigation stack the app mounts.

| Field | Type | Notes |
|---|---|---|
| `name` | String | Collected at onboarding |
| `phone` | String, **unique** | The login identity; no email, no password |
| `role` | `'FARMER' \| 'TRANSPORTER'` | Set once at onboarding, not switchable in the MVP |
| `language` | `'mr' \| 'hi' \| 'en' \| …` | Default language for Servo AI; chosen on the welcome screen |
| `defaultLocation` | `{ name, lat, lng }` | Farmer's usual pickup point, so it isn't re-entered per request |
| `pushToken` | String | Expo push token, registered via `PATCH /users/me` on login |
| `ratingAvg` | Number | **Derived** — rolled up from `Rating` docs, never written directly by a client |
| `ratingCount` | Number | **Derived** — same |
| `phoneVerifiedAt` | Date | Set on successful OTP verification |
| `createdAt`, `updatedAt` | Date | |

---

## Vehicle

A transporter's vehicle and its live capacity. This is the unit that matching scores — not the user.

| Field | Type | Notes |
|---|---|---|
| `ownerId` | ObjectId → `User` | The transporter |
| `vehicleType` | `'PICKUP' \| 'TRUCK' \| 'TEMPO' \| 'TRACTOR' \| 'MINI_TRUCK' \| 'OTHER'` | |
| `capacityKg` | Number | Total rated capacity |
| `availableCapacityKg` | Number | Decremented on booking commit; the concurrency-critical field |
| `currentLocation` | `{ lat, lng }` | Updated from the transporter's GPS pushes |
| `ratePerKm` | Number | Input to `totalCost = distanceKm × ratePerKm` |
| `status` | `'AVAILABLE' \| 'BUSY' \| 'OFFLINE'` | `OFFLINE` is the availability toggle; `BUSY` is set automatically when capacity is full |
| `verificationStatus` | `'PENDING' \| 'VERIFIED' \| 'REJECTED'` | **The KYC gate.** Only `VERIFIED` vehicles are ever returned by matching |
| `createdAt`, `updatedAt` | Date | |

---

## Document

A KYC artefact uploaded by a transporter. The binary lives in Cloudinary/S3; only its URL is stored here.

| Field | Type | Notes |
|---|---|---|
| `userId` | ObjectId → `User` | Owner of the document |
| `type` | `'RC' \| 'DL' \| 'AADHAAR' \| 'PAN'` | RC + DL gate matching; PAN gates payouts |
| `fileUrl` | String | Cloudinary/S3 URL |
| `status` | `'PENDING' \| 'VERIFIED' \| 'REJECTED'` | Flipped by the manual review endpoint |
| `reviewedAt` | Date | Set when an operator reviews it |
| `createdAt` | Date | |

---

## TransportRequest

The farmer's job. Also serves as the "trip" once booked — trip routes are keyed by this `_id`.

| Field | Type | Notes |
|---|---|---|
| `farmerId` | ObjectId → `User` | |
| `cropType` | String | e.g. onion, tomato |
| `quantityKg` | Number | Matched against `availableCapacityKg` |
| `pickup` | `{ name, lat, lng }` | From Google Places |
| `destination` | `{ name, lat, lng }` | Mandi or other drop point |
| `preferredDate` | Date | |
| `status` | `'DRAFT' \| 'SEARCHING' \| 'MATCHED' \| 'PAYMENT_PENDING' \| 'BOOKED' \| 'IN_TRANSIT' \| 'DELIVERED' \| 'CANCELLED'` | See the lifecycle below |
| `createdAt`, `updatedAt` | Date | |

**Status lifecycle:** `DRAFT` → `SEARCHING` (matching runs) → `MATCHED` (top 3 offered) → `PAYMENT_PENDING` (farmer accepted, order created) → `BOOKED` (payment captured *and* capacity committed) → `IN_TRANSIT` → `DELIVERED`. `CANCELLED` is reachable from any pre-delivery state and applies the refund policy for the state it was in.

The proof-of-delivery photo URL is stored on this document when the transporter marks delivery.

---

## Match

One scored offer of a vehicle against a request. Three of these are created per matching run.

| Field | Type | Notes |
|---|---|---|
| `requestId` | ObjectId → `TransportRequest` | |
| `vehicleId` | ObjectId → `Vehicle` | |
| `score` | Number | 60% proximity + 40% capacity utilisation |
| `distanceKm` | Number | Real driving distance from the Directions proxy once available |
| `totalCost` | Number | `distanceKm × ratePerKm` |
| `farmerShare` | Number | **Derived** — `totalCost × 0.6`; this is what the farmer actually pays |
| `transporterShare` | Number | **Derived** — `totalCost × 0.4`; this is what gets transferred out |
| `status` | `'PENDING' \| 'ACCEPTED' \| 'REJECTED' \| 'EXPIRED'` | Only becomes `ACCEPTED` on the post-payment capacity commit |
| `createdAt` | Date | |

---

## Payment

The farmer's payment for their share, and the record of the payout derived from it. There is no other money record.

| Field | Type | Notes |
|---|---|---|
| `requestId` | ObjectId → `TransportRequest` | Also used as the Razorpay `receipt` |
| `farmerId` | ObjectId → `User` | |
| `razorpayOrderId` | String | From the Orders API |
| `razorpayPaymentId` | String | From checkout / webhook |
| `razorpaySignature` | String | The client-returned signature that was verified server-side |
| `amount` | Number | The farmer's share. Stored in rupees here; converted to paise when creating the order |
| `currency` | `'INR'` | INR only |
| `status` | `'CREATED' \| 'PAID' \| 'FAILED' \| 'REFUNDED' \| 'PARTIALLY_REFUNDED'` | `PAID` is set by the webhook, not the client callback |
| `platformFee` | Number | What KisanPool keeps |
| `transporterPayoutAmount` | Number | `transporterShare` minus the platform fee |
| `transferId` | String | Razorpay Route transfer id, once settled |
| `createdAt`, `updatedAt` | Date | |

---

## TransporterPayoutAccount

The transporter's Razorpay Route linked account. Without one in `ACTIVE`, no payout can be made.

| Field | Type | Notes |
|---|---|---|
| `userId` | ObjectId → `User` | The transporter |
| `razorpayContactId` | String | |
| `razorpayFundAccountId` | String | Bank account + IFSC, held by Razorpay |
| `razorpayAccountId` | String | The linked account that receives transfers |
| `payoutStatus` | `'NOT_ONBOARDED' \| 'PENDING' \| 'ACTIVE'` | Driven by the KYC screen and Razorpay's onboarding response |
| `createdAt`, `updatedAt` | Date | |

Bank account numbers, IFSC and PAN are submitted straight to Razorpay; we persist the resulting Razorpay ids, not the raw instrument details.

---

## Rating

One directional review, created after a trip reaches `DELIVERED`.

| Field | Type | Notes |
|---|---|---|
| `tripId` | ObjectId → `TransportRequest` | |
| `fromUserId` | ObjectId → `User` | Author |
| `toUserId` | ObjectId → `User` | Subject; their `ratingAvg` is recomputed |
| `stars` | Number, 1–5 | |
| `comment` | String | Optional |
| `createdAt` | Date | |

---

## ChatMessage

One in-trip message. Persisted so the thread survives a socket reconnect.

| Field | Type | Notes |
|---|---|---|
| `tripId` | ObjectId → `TransportRequest` | Also the socket room id |
| `senderId` | ObjectId → `User` | |
| `text` | String | |
| `createdAt` | Date | |

---

## AiSession

Conversation state for Servo AI. Holds history so a multi-turn booking conversation makes sense; it holds no authority.

| Field | Type | Notes |
|---|---|---|
| `userId` | ObjectId → `User` | Identity always comes from the JWT, never from the transcript |
| `history` | `[{ role, content, ts }]` | Replayed into the Sarvam chat completion |
| `detectedLanguage` | String | From STT, optionally confirmed by `/text-lid` |
| `updatedAt` | Date | |

---

## Relationships

```
User (FARMER) ──1:N──▶ TransportRequest ──1:N──▶ Match ──N:1──▶ Vehicle ──N:1──▶ User (TRANSPORTER)
                              │                                                      │
                              ├──1:1──▶ Payment ──(transfer)──▶ TransporterPayoutAccount
                              ├──1:N──▶ ChatMessage
                              └──1:N──▶ Rating (fromUserId / toUserId → User)

User (TRANSPORTER) ──1:N──▶ Document
User ──1:N──▶ AiSession
```

- `Vehicle.ownerId` → `User`
- `Document.userId` → `User`
- `TransportRequest.farmerId` → `User`
- `Match.requestId` → `TransportRequest`, `Match.vehicleId` → `Vehicle`
- `Payment.requestId` → `TransportRequest`, `Payment.farmerId` → `User`
- `TransporterPayoutAccount.userId` → `User`
- `Rating.tripId` → `TransportRequest`, `Rating.fromUserId` / `Rating.toUserId` → `User`
- `ChatMessage.tripId` → `TransportRequest`, `ChatMessage.senderId` → `User`
- `AiSession.userId` → `User`

---

## Derived / computed fields

These are written by the backend from other records and must never be accepted from a client payload:

| Field | Derived from |
|---|---|
| `User.ratingAvg`, `User.ratingCount` | Aggregated over `Rating` documents where `toUserId` is the user |
| `Match.score` | 60% normalized proximity + 40% capacity utilisation, in `matchingService` |
| `Match.totalCost` | `distanceKm × Vehicle.ratePerKm` |
| `Match.farmerShare` | `totalCost × 0.6` |
| `Match.transporterShare` | `totalCost × 0.4` |
| `Payment.platformFee` | Configured platform cut |
| `Payment.transporterPayoutAmount` | `transporterShare − platformFee` |
| `Payment.status` | Razorpay webhook events, plus server-side signature verification |
| `Payment.transferId` | Razorpay Route transfer creation / `transfer.processed` |
| `Vehicle.availableCapacityKg`, `Vehicle.status` | Booking commit and delivery, inside a MongoDB session |
| `TransportRequest.status` | Service transitions only — never a direct client write |
