# KisanPool — Architecture Decision Record

**New entries must be appended here any time a non-trivial technical decision is made during implementation — do not silently decide and move on.**

Number entries sequentially (ADR-0XX), never renumber or delete an accepted entry — supersede it with a new one that references it.

---

## ADR-001: One Expo app with role-gated navigation, not two apps
Date: 2026-08-28
Status: Accepted
Context: KisanPool serves two distinct audiences — farmers booking transport and transporters carrying it — with almost no screen overlap. The obvious instinct is to ship two apps.
Decision: Build a single Expo (React Native + TypeScript) project. `User.role` is set once at onboarding; after OTP verification the root navigator mounts either the `(farmer)` or the `(transporter)` Expo Router group. `(auth)` is shared by both.
Rationale: One codebase, one build pipeline, one shared shell (header, mic button, `<TripMap />`, socket, push permissions) and one set of API helpers. The role is a field on a user, not a reason to duplicate an entire project.
Alternatives considered: Two separate Expo apps — rejected as double the build, release and dependency maintenance for a hackathon-scale MVP. A single app with runtime role switching — deferred; see ADR-002.

## ADR-002: One role per account for the MVP
Date: 2026-08-28
Status: Accepted
Context: A farmer who also owns a tractor could plausibly want both roles on one login.
Decision: `User.role` is immutable after onboarding. Someone needing both creates a second account with a different phone number.
Rationale: Multi-role identity leaks into auth, navigation, matching eligibility and payouts simultaneously. Not worth it before the core loop is proven.
Alternatives considered: A `roles: []` array with an in-app switcher — deferred to post-MVP.

## ADR-003: MongoDB + Mongoose instead of a relational database
Date: 2026-08-28
Status: Accepted
Context: The domain has clear entities and relationships that would map cleanly to Postgres, and money movement usually argues for a relational store.
Decision: MongoDB Atlas with Mongoose, per the project requirement. The one place we need atomicity — the booking capacity commit — uses a MongoDB session plus a conditioned `findOneAndUpdate`.
Rationale: It was a stated project constraint, and the transactional surface is narrow enough (one capacity decrement) that sessions cover it.
Alternatives considered: PostgreSQL with Prisma — better transactional ergonomics, but outside the stated requirement.

## ADR-004: Socket.io for real-time instead of polling
Date: 2026-08-28
Status: Accepted
Context: Match offers, trip status, live vehicle position and in-trip chat all change on sub-minute timescales; polling four endpoints would be both laggy and wasteful.
Decision: Socket.io mounted on the same HTTP server as Express, rooms keyed by `requestId` / `tripId`, handshake authenticated with the same JWT as REST.
Rationale: Live location at ~5s intervals and chat are genuinely push-shaped problems. Sharing the HTTP server keeps it to one process with no extra infrastructure.
Alternatives considered: HTTP polling — rejected on latency and battery. Server-Sent Events — one-directional, so chat and GPS uplink would need a second channel anyway.

## ADR-005: Expo push notifications alongside sockets, not instead of them
Date: 2026-08-28
Status: Accepted
Context: A socket only delivers while the app is foregrounded, but a farmer waiting on a match or a payment confirmation will background the app.
Decision: Use `expo-notifications` with the Expo Push API for match found, payment captured, trip status changed and new chat message. The push token is registered on login via `PATCH /users/me`.
Rationale: Sockets and pushes solve different halves of the same problem — neither is sufficient alone.
Alternatives considered: Sockets only — rejected; the demo's most impressive moments happen while the app is not on screen.

## ADR-006: Sarvam AI as the single voice and language vendor
Date: 2026-08-28
Status: Accepted
Context: The voice assistant needs speech-to-text, language identification, an LLM and text-to-speech, all strong in Indian languages.
Decision: Sarvam for all four — `saaras:v3` for STT, `sarvam-m` for chat completion, `bulbul:v3` for TTS, `/text-lid` as a confirmation pass only when the STT-reported language looks inconsistent. All proxied through our backend so the key stays server-side.
Rationale: Indian-language-native across the whole pipeline, one key, one vendor, one failure mode — rather than stitching three providers with different language coverage.
Alternatives considered: Whisper + a general LLM + a separate TTS — more moving parts and weaker Marathi/Hindi coverage.

## ADR-007: Razorpay Route for payouts instead of a custom ledger or wallet
Date: 2026-08-28
Status: Accepted
Context: Every trip splits money between the farmer's payment, the transporter's share and the platform fee. The tempting build is an internal wallet.
Decision: Razorpay Orders collects the farmer's share; Razorpay Route transfers the transporter's share to their linked account; Razorpay Refunds handles cancellations. Our only money records are the `Payment` and `TransporterPayoutAccount` documents.
Rationale: Route is purpose-built for exactly this marketplace split in India. A custom ledger means holding other people's money, reconciliation, and regulatory exposure — none of which belongs in an MVP.
Alternatives considered: A wallet with stored value — explicitly rejected in the brief. Manual bank transfers — not automatable and no audit trail.

## ADR-008: A booking is confirmed only after payment capture, not at match accept
Date: 2026-08-28
Status: **Superseded by ADR-031** (2026-08-29) — with shared pricing the final amount is not knowable until the pool stops changing, so billing moved after delivery.
Context: The natural design is to confirm the booking when the farmer accepts a match, then collect payment. That leaves capacity reserved against payment that may never arrive.
Decision: `POST /transport/requests/:id/accept` creates a `Payment` in `CREATED` and moves the request to `PAYMENT_PENDING` only. The capacity commit — conditioned `findOneAndUpdate` inside a MongoDB session, `Match` → `ACCEPTED`, request → `BOOKED`, capacity decremented — runs on payment capture. A lost race returns `CONCURRENT_BOOKING` and refunds immediately.
Rationale: Capacity is the scarce resource and money is the only real signal of intent. Committing at accept-time either lets unpaid bookings block vehicles or requires a reservation-expiry system we do not want to build.
Alternatives considered: Soft-hold with a TTL at accept-time — extra state machine, extra failure mode, no clear benefit at this scale.

## ADR-009: One shared theme based on the farmer token set; Premium tones as a transporter accent only
Date: 2026-08-28
Status: **Superseded by ADR-017** (2026-08-28) — the transporter accent was dropped entirely; the Farmer set is now the sole design system.
Context: The two Stitch exports disagree — Agri-Logistics Standard uses Inter with `#0d631b`/`#2e7d32` and 8/16/24px radii; Agri-Tech Premium uses Manrope + Be Vietnam Pro with a near-black `#052405` primary and a much rounder radius scale.
Decision: One `theme.ts` built on the Standard set, including Inter as the single family. The Premium palette's darker tones are available as an opt-in accent for transporter-only screens; its dual-font strategy is not adopted.
Rationale: Two font families across one build costs bundle size and consistency for a difference users switching between roles will never see. Inter also carries Devanagari for the bilingual pattern the Standard set specifies.
Alternatives considered: Fully separate themes per role — rejected as visual drift with no user benefit. Adopting Premium as the base — rejected because the farmer flow is the larger surface and the brief names the Standard tokens as the shared base.

## ADR-010: KYC verification gates whether a vehicle appears in matching at all
Date: 2026-08-28
Status: Accepted
Context: An unverified transporter accepting real loads and real money is the fastest way to lose farmer trust.
Decision: A `Vehicle` stays `verificationStatus: 'PENDING'` — and is filtered out by the matching query itself — until its owner's RC and DL are reviewed and marked `VERIFIED`. PAN and bank details additionally gate payout eligibility.
Rationale: Enforcing this in the query rather than the UI means no client change or API poke can surface an unverified vehicle. It is an authorization rule, not a badge.
Alternatives considered: Showing unverified vehicles with a warning label — rejected; it puts the trust decision on the farmer.

## ADR-011: KYC review is a manual, API-only action in the MVP
Date: 2026-08-28
Status: **Superseded by ADR-026** (2026-08-28) — an operator console now exists at `apps/admin`.
Context: Real verification needs either an operations team or a document-verification vendor. Neither fits a hackathon timeline.
Decision: `PATCH /documents/:id/review` is a protected route an operator calls by hand during the demo. There is no admin dashboard.
Rationale: It exercises the full gating path end to end without building a second front-end that is not part of the product story.
Alternatives considered: Auto-approving uploads — would make ADR-010 meaningless. Building an admin UI — explicitly out of scope.

## ADR-012: The Razorpay webhook, not the client callback, is the source of truth for payment state
Date: 2026-08-28
Status: Accepted
Context: The mobile checkout SDK returns a signature triple on success, but the app can be killed, backgrounded or offline at exactly that moment.
Decision: `POST /payments/verify` recomputes `HMAC_SHA256(orderId|paymentId, RAZORPAY_KEY_SECRET)` and rejects mismatches, but `Payment.status` is finally settled by the signature-verified `payment.captured` / `payment.failed` / `transfer.processed` webhook. The webhook route is mounted with a raw-body parser and is the one route not behind a JWT.
Rationale: Client callbacks confirm nothing about whether money actually moved. Two independent verifications — signature and webhook — is the standard, and it is what makes reconciliation possible.
Alternatives considered: Trusting the client callback alone — rejected outright. Polling Razorpay for order status — a fallback we may still add, not a replacement.

## ADR-013: Cancellation and refund percentages are configuration, not code
Date: 2026-08-28
Status: Accepted
Context: The policy is a full refund minus a small fee before pickup, and no automatic refund after pickup.
Decision: The fee lives in `PLATFORM_CANCELLATION_FEE_PCT` (default 5), read at runtime. Post-pickup refunds are deliberately not automated — support overrides them by hand.
Rationale: Pricing policy changes far more often than code should. Hardcoding it guarantees a stale literal somewhere in the payments module.
Alternatives considered: A hardcoded 5% — rejected. A per-route configurable policy table — over-engineered for one number.

## ADR-014: The LLM gets exactly six tools and never writes to the database
Date: 2026-08-28
Status: Accepted
Context: A voice assistant that can "do anything" is a liability the moment it touches money or state.
Decision: Servo AI may call only `getUserProfile`, `findMatchingVehicles`, `createTransportRequest`, `acceptMatch`, `getTripStatus`, `cancelRequest`. Each calls the same service function the equivalent REST route calls. The authenticated user id comes from the JWT, never from speech. `acceptMatch` hands off to the checkout screen and never pays. State-changing tools require an explicit spoken confirmation first; ambiguity produces a follow-up question, not a guess.
Rationale: This is the Golden Rule made concrete — the model understands, the backend decides. Reusing the REST service functions means every validation a human tap triggers also runs for a voice request, with no second, looser path into the domain.
Alternatives considered: Giving the model direct database access or a generic query tool — rejected as unsafe at any scale. Letting it complete payment by voice — rejected; payment stays in the native Razorpay sheet.

## ADR-015: Plain `fetch()` in one `api.ts`, no data-fetching library
Date: 2026-08-28
Status: Accepted
Context: React Query or Axios would be the reflexive choice for an app with this many endpoints.
Decision: One `lib/api.ts` helper over `fetch()`, one function per REST resource, JWT read from `expo-secure-store`, throwing whenever a response has `success: false`. No React Query, Axios or Redux.
Rationale: The screens that need live data are already driven by sockets, which is where caching and invalidation would otherwise earn their keep. The remaining calls are simple request/response.
Alternatives considered: React Query — real value at larger scale, but redundant against the socket layer here.

## ADR-016: Uploaded files go to Cloudinary/S3; MongoDB stores only URLs
Date: 2026-08-28
Status: Accepted
Context: KYC documents and proof-of-delivery photos are binary and user-supplied.
Decision: Upload to Cloudinary (or any S3-compatible bucket) and persist only the resulting URL on the `Document` or `TransportRequest`.
Rationale: Binary blobs in Mongo bloat documents, slow queries and complicate backups, for no benefit.
Alternatives considered: GridFS — extra complexity for something object storage already does well.

## ADR-017: The Farmer design system is the single design standard for the entire app
Date: 2026-08-28
Status: Accepted
Supersedes: ADR-009
Context: ADR-009 kept the Agri-Tech Premium palette available as an opt-in accent for transporter-only screens. In practice that leaves two colour stories, two radius scales and a standing invitation to drift — and a shared component library cannot honour both without branching on role.
Decision: The Farmer set, Agri-Logistics Standard, is the only design system in the app. Inter is the only font family. Primary Green `#0d631b` (`primary`), Secondary Green `#2e7d32` (`primary-container`), and the radius scale whose three carrying values are 8px (buttons, inputs), 16px (cards) and 24px (banners, sheets). One `theme.ts`, one set of components, no per-role theme, no theme override map, no role-conditional styling. The Agri-Tech Premium system — Manrope, Be Vietnam Pro, `#052405`, `#1b3a18`, `#3b6934`, `#012410`, `#f8faf7` and its 16/24/32/48px radii — is not used anywhere.
Rationale: A single token set is the only version of "consistent" that survives contact with a shared component library. Two font families also cost bundle size and Devanagari coverage work for a difference no user switching between roles would ever see. The transporter Stitch export remains useful as a record of screen layout and content; its styling is discarded.
Alternatives considered: Keeping the accent as an opt-in (ADR-009) — rejected, since an opt-in that only ever applies to one route group is a second theme with extra steps. Adopting Premium as the app-wide base — rejected; the farmer flow is the larger surface and the Standard tokens are what brief §4.2 names as the shared base.

## ADR-018: A closed set of 25 error codes, defined once in `packages/shared`
Date: 2026-08-28
Status: Accepted
Context: The first draft of `docs/API_CONTRACTS.md` §5 listed 25 codes with inconsistent naming (`INVALID_OTP` next to `PAYMENT_SIGNATURE_INVALID`, `NOT_FOUND` next to `VEHICLE_CAPACITY_EXCEEDED`), several near-duplicates (`UNAUTHENTICATED`/`TOKEN_EXPIRED`, `PAYMENT_SIGNATURE_INVALID`/`WEBHOOK_SIGNATURE_INVALID`, `REFUND_NOT_ALLOWED`/`PAYMENT_NOT_CAPTURED`), and an open invitation to "extend the list as needed" — which in practice means every module inventing its own strings.
Decision: Exactly 25 codes, grouped Authentication (4), KYC (3), Payments (6), Concurrency (2), Transport (3), Booking (2), AI (2), Cross-cutting (3). The set is closed: adding a code requires an ADR and a change to `docs/API_CONTRACTS.md` §5 first. All 25 live in `packages/shared/src/errors.ts` — with an HTTP status map and a client handling strategy per code — and are imported by the server's error helper and the app's error handler alike. Upstream failures map to the domain code of the operation that failed; `EXTERNAL_SERVICE_ERROR` is only for upstream failures with no domain meaning.
Rationale: A closed, shared union is what makes frontend handling deterministic — the app's handler is a switch over the union with no default branch, so an unhandled code is a compile error rather than a silent generic toast. Codes that differ only in wording produce screens that differ only in wording, which is exactly the inconsistency this replaces.
Alternatives considered: An open, growable list with a naming convention — rejected; conventions without enforcement drift within a sprint. Per-module code prefixes (`PAY_*`, `TXN_*`) — rejected as ceremony that makes reuse across modules awkward. Relying on HTTP status alone — rejected; 409 covers five distinct situations here that need five distinct screens.

## ADR-019: Every third-party integration has a working local fallback
Date: 2026-08-28
Status: Accepted
Context: The build depends on five external services — an SMS provider, Razorpay, Google Maps, Cloudinary and Sarvam. Requiring all five before anything runs would make the project undemonstrable on a laptop and untestable in CI.
Decision: Each integration degrades to a documented local behaviour when its key is absent. No OTP provider prints the code to the console and returns it as `devCode`; no Razorpay keys runs checkout in demo mode where the signature check is skipped **only** for `order_demo_*` ids while verify → capture → booking commit still executes in full; no Maps key falls back to haversine × 1.3 with no polyline; no Cloudinary writes to `apps/server/uploads/` and serves it statically; no Sarvam key returns `AI_TOOL_ERROR` from STT/TTS and drives `/ai/chat` through a deterministic parser.
Rationale: The fallbacks preserve the real control flow rather than stubbing it out, so the concurrency test, the booking state machine and the payout path are all genuinely exercised without an account anywhere. Each one degrades honestly — nothing fabricates a result and pretends the service answered.
Alternatives considered: Requiring every key — blocks the demo and CI. Mocking the services in tests only — the code paths that run in the demo would then never be the ones under test.

## ADR-020: A Mongo write conflict is the same event as losing the capacity race
Date: 2026-08-28
Status: Accepted
Context: The concurrency test exposed a real defect. Two farmers paying for the last space at the same instant can lose the race two ways: our conditioned `findOneAndUpdate` matches nothing, or MongoDB aborts one transaction with `WriteConflict` (code 112, `TransientTransactionError`) before our condition is ever evaluated. Only the first was handled, so the second surfaced as `EXTERNAL_SERVICE_ERROR` and — worse — skipped the automatic refund, leaving a captured payment with no booking.
Decision: `commitBooking` maps a write conflict onto `CONCURRENT_BOOKING`, the same code the conditioned-update miss produces. Both therefore trigger the same automatic full refund and the same message.
Rationale: The distinction is an implementation detail of the storage engine; to the farmer both are "someone else took that vehicle". Money must never be captured without either a booking or a refund, and a code that only covers one of two race outcomes cannot guarantee that.
Alternatives considered: Retrying the transaction on a transient label — plausible, but it races again against a vehicle that is now genuinely full, and the honest answer is to refund and re-offer. A distinct error code — rejected; it would need identical handling on both sides of the wire.

## ADR-021: Seeded ratings are backed by real Rating documents
Date: 2026-08-28
Status: Accepted
Context: The first seed wrote `ratingAvg: 4.8, ratingCount: 126` directly onto transporter users with no `Rating` documents behind them. The first genuine review then recomputed the rollup from actual documents and replaced it with `5.0 (1)` — a visible, confusing regression on the match cards.
Decision: The seed creates past delivered trips with real `Rating` documents in both directions, then computes `ratingAvg`/`ratingCount` with the same rollup the ratings route uses.
Rationale: Derived fields must never be hand-written, including by fixtures — a fixture that cannot be reproduced by the code that maintains the field is a bug waiting for its first real write. It also gives the demo coherent trip history behind each rating.
Alternatives considered: Preserving seeded aggregates by adding them to the rollup — would mean the service trusting numbers it cannot derive, which is exactly what `docs/DATA_MODEL.md` forbids.

## ADR-022: The voice fallback resolves only what was actually spoken
Date: 2026-08-28
Status: Accepted
Context: Without a Sarvam key `/ai/chat` needs some intent handling, and the naive version either guessed missing details or could not complete a booking at all.
Decision: The fallback matches crops and mandis against a known list and parses quantities including quintals and tonnes, filling in **only** values present in the utterance; anything missing produces a specific follow-up question naming what it still needs. Accepting a match reads the farmer's real open request and its top-scoring match from the database and states the transporter's name and the exact amount before asking for a yes.
Rationale: This keeps the fallback inside the same safety envelope as the LLM path — no invented facts, confirmation before any state change, and the checkout handoff instead of payment — while making the full voice path demonstrable without a vendor key.
Alternatives considered: Refusing all voice bookings without a Sarvam key — safe but leaves the flow undemonstrable. Letting the fallback assume a default crop or the nearest mandi — rejected outright; guessing on the user's behalf is the failure mode the Golden Rule exists to prevent.

## ADR-023: A confirmation is disarmed and persisted before its tool runs
Date: 2026-08-28
Status: Accepted
Context: A second test run surfaced a defect: when a confirmed tool call threw, the in-memory clearing of `pendingConfirmation` was never saved, so the session kept the confirmation armed forever. Every later message in that session was read as an answer to the old question, with the old arguments — the farmer could not escape it.
Decision: On an affirmative reply the pending confirmation is cleared and the session saved **before** the tool executes. A failing tool therefore leaves a clean session, and its error is reported normally.
Rationale: A confirmation is consumed by being answered, not by the tool succeeding. Persisting only on success makes failure sticky and repeats a state-changing intent against stale arguments — the opposite of what the confirmation gate is for.
Alternatives considered: Clearing in a `finally` — still leaves a window where the process can die with it armed, and reads less obviously.

## ADR-024: Expo SDK 54 (React Native 0.81, React 19)
Date: 2026-08-28
Status: Accepted
Context: The app was scaffolded on Expo SDK 52 (RN 0.76, React 18). Staying two majors behind means missing New Architecture defaults and taking a larger, riskier jump later.
Decision: Upgraded to Expo SDK 54 — `expo@54`, `react-native@0.81.5`, `react@19`, `expo-router@6`, with `babel-preset-expo` added as an explicit devDependency (SDK 54 no longer supplies it transitively) and `@types/react@19`. No application code needed changing: typecheck passes and the Android bundle builds at 7.6 MB with all 27 routes.
Rationale: The upgrade is purely a dependency move — the screens, theme and libs are unaffected — so it is cheapest to take now, while the app has no users and the integration suite can prove nothing regressed.
Alternatives considered: Staying on SDK 52 — accumulates upgrade debt against a Expo deprecation window. Jumping to SDK 55 — not released; SDK 55 also removes `expo-av`, which this app still uses (see below).
Follow-up: `expo-av` is **deprecated in SDK 54 and removed in SDK 55**. `components/VoiceAssistantButton.tsx` uses it for recording and playback and must migrate to `expo-audio` before the next SDK bump.

## ADR-025: Fast2SMS for OTP delivery, with the route as configuration
Date: 2026-08-28
Status: Accepted
Context: OTP delivery was a stub — the code was logged to the console. A real provider was needed, and Fast2SMS offers three different sending routes with different account prerequisites.
Decision: Fast2SMS via `GET https://www.fast2sms.com/dev/bulkV2`, with the route in `FAST2SMS_ROUTE` rather than hardcoded. The `otp` route is the natural default but requires website verification on the Fast2SMS account (it fails with status 996 until then); `q` works on a fresh account and is what this deployment uses; `dlt` is available for a DLT-registered template. The demo-mode console fallback is unchanged when no key is set.
Rationale: The route that works depends on the account's verification state, not on the code — so it belongs in configuration, exactly like the cancellation fee (ADR-013). Making it an env var meant switching from a refused route to a working one without touching a line of code.
Alternatives considered: Hardcoding the `otp` route — would have left this deployment unable to send at all. A different provider — Fast2SMS was the stated choice.
Note: Fast2SMS reports business failures (no balance, unverified account, bad number) with **HTTP 200 and `return: false`**, so the response body is the only signal — checking the status code alone would silently drop every failed OTP.

## ADR-026: An operator console at `apps/admin`, authenticated by an `admin` claim
Date: 2026-08-28
Status: Accepted
Supersedes: ADR-011
Context: ADR-011 kept KYC review as a hand-rolled `curl` because an admin UI was out of MVP scope. In practice an operator also needs to see who has signed up, what the platform is doing overall, and which vehicles are on the road — none of which is reasonable through curl. Reviewing this also surfaced a real hole: `PATCH /documents/:id/review` was gated on `requireAuth` alone, so **any signed-in transporter could approve their own documents** and walk straight through the KYC gate that ADR-010 exists to enforce.
Decision: A small Vite + React console at `apps/admin` with four tabs — Overview, Users, Verification, Vehicles — talking to a new `/admin/*` router. Operators authenticate with `POST /admin/login` against `ADMIN_USERNAME`/`ADMIN_PASSWORD` (defaulting to admin/admin, with a startup warning and an in-app banner while the defaults are in use) and receive a 12-hour JWT carrying an `admin: true` claim. `requireAdmin` checks that claim, and `PATCH /documents/:id/review` now uses it.
Rationale: Admin is deliberately **not** a `User.role`. An operator is not an account in the marketplace, and adding `'ADMIN'` to the role union would leak into every role-gated query, navigation branch and matching filter. A separate claim keeps the blast radius at one middleware. The console reuses the shared error codes and the Farmer design tokens, so it is not a second design or error vocabulary (ADR-017, ADR-018).
Alternatives considered: Keeping curl-only (ADR-011) — leaves the self-approval hole unnoticed and the operator blind. A full user/permission system with admin accounts in Mongo — real scope, and the wrong shape for one operator on a hackathon build. Serving the console from Express as static HTML — no typechecking against the shared package, which is what keeps the error codes honest.
Note: the console cannot bypass the KYC gate. `PATCH /admin/vehicles/:id` refuses to set an unverified vehicle to `AVAILABLE`, returning `KYC_PENDING_REVIEW`.

## ADR-027: Push registration degrades to a no-op in Expo Go
Date: 2026-08-28
Status: Accepted
Context: Expo Go dropped remote push notifications in SDK 53. After the SDK 54 upgrade (ADR-024), `expo-notifications` throws on **import** inside Expo Go — not on use — so the static import at the top of `lib/notifications.ts` crashed `(auth)/success.tsx` before it could render. Testing the onboarding flow in Expo Go became impossible.
Decision: `lib/notifications.ts` no longer imports `expo-notifications` at module scope. It detects Expo Go via `Constants.executionEnvironment === ExecutionEnvironment.StoreClient` and returns early; otherwise it lazily `require`s the module on first use and installs the notification handler there. `registerForPush()` returns `null` rather than throwing, and a `pushSupported()` helper is exported for any UI that wants to be honest about it.
Rationale: A module that throws on import makes every screen importing it unopenable, which is a far worse failure than the missing feature. Sockets already cover the foreground case, so in Expo Go the app loses only backgrounded-app notifications and keeps live matching, tracking and chat — a reasonable trade for being able to test the flow at all.
Alternatives considered: Requiring a development build for all testing — correct for a push demo, but it makes every unrelated screen change a native rebuild. Wrapping the import in try/catch — does not help, ES module imports are hoisted and the throw happens before any handler runs. Removing push entirely — it is core to the trust story (ADR-005).
Note: remote push must still be demonstrated on a development build; Expo Go cannot show it at all.

## ADR-028: The trip detail carries the counterparty and the accepted match
Date: 2026-08-28
Status: Accepted
Context: A transporter audit found two screens that could not work with the data they had. The in-trip **Call** button opened `tel:` with no number, because no endpoint ever gave either party the other's phone. The **completion** screen read the cost split from `GET /transport/requests/:id/matches`, which returns only `PENDING` offers — those are `ACCEPTED`/`EXPIRED` the moment a booking commits, so the final billing screen could render ₹0 on a real delivered trip.
Decision: `GET /transport/requests/:id` now also returns `counterparty` (the other party's name, phone and rating) and `match` (the accepted match with its cost split). The route already proves the caller is a party to the trip, so the phone is only ever disclosed to the one person entitled to call it, and only the *other* party's.
Rationale: Both screens needed a fact the API had but never exposed, and both failed silently — an empty dialer and a ₹0 total look like working screens until someone taps them. Adding the two fields to the detail the screens already fetch avoids a second round trip and keeps the party check in one place.
Alternatives considered: A masked-call proxy — explicitly out of MVP scope (docs/PRD.md §5). Returning all matches regardless of status — would put expired offers back on the match list. A separate `/counterparty` endpoint — a second permission check to keep in sync for no benefit.

## ADR-029: A rejection reason is chosen by the driver, not assumed
Date: 2026-08-28
Status: Accepted
Context: `available_trips` sent the literal string `'Not on my route'` to `POST /trips/:matchId/reject` for every rejection, whatever the real reason. The brief calls for "accept/reject with a reason", and the reason is the only signal we get about why matching is offering the wrong loads.
Decision: Rejecting opens a sheet with four common reasons plus a free-text field; nothing is submitted until the driver picks one. The "Accept trip" button was also relabelled **View trip**, because there is no transporter-accept endpoint — the farmer accepts and pays, and the button only navigated.
Rationale: A hardcoded reason is worse than no reason: it looks like data and poisons any analysis of why loads get refused. And a button labelled "Accept" that accepts nothing is a promise the app does not keep.
Alternatives considered: Free text only — most drivers would skip it. Adding a real transporter-accept endpoint — changes the booking model (ADR-008), which is not what this audit was for.

## ADR-030: Pooling is a Trip of many Shipments, claimed by transporters and chosen by farmers
Date: 2026-08-29
Status: Accepted
Supersedes the `Match` model and `modules/matching` entirely.
Context: An audit against PROMPT_1 §4 and PROMPT_2 §6–13 found the pooling model inverted and, worse, economically inert. The system generated ranked `Match` offers *for* the farmer; the transporter had no way to accept anything. There was no object representing a shared journey — a `TransportRequest` **was** the trip — so two farmers on one vehicle were two unrelated bookings that **each paid the full `distance × rate` fare**. Capacity decremented, so they physically shared the truck, but the vehicle collected twice and neither farmer saved a rupee. The product's entire promise was missing from the code.
Decision: Four new entities. A **request** sits in a pool with its own short lifecycle (`OPEN → TRANSPORTER_INTERESTED → CONFIRMED`). A **TransporterOffer** is a claim — many transporters may claim one request, one transporter may claim many, and a claim reserves nothing. A **Trip** is one vehicle's shared journey to one mandi; a **TripShipment** is one farmer's produce on it, with its own lifecycle through pickup, delivery and payment. The farmer chooses among real claimants, and only that choice reserves capacity. `Match` and the matching service are deleted.
Rationale: The three things — a request, a journey, and one farmer's produce on it — fail and advance for different reasons, so one status field made every transition ambiguous. Separating them is what lets four farmers ride one truck while each is picked up, delivered and billed independently.
Alternatives considered: Keeping `Match` and adding a transporter-accept — leaves no place to hang a shared route or a shared price. Modelling the pool as an array on the vehicle — no history, no audit, no per-farmer lifecycle.

## ADR-031: Shared pricing, and billing after delivery
Date: 2026-08-29
Status: Accepted
Supersedes: ADR-008
Context: One route has one cost. Under the old model each farmer paid `distanceKm × ratePerKm × 0.6` in full and independently, so pooling raised the vehicle's revenue and lowered nobody's bill. PROMPT_2 §12 requires the route cost to be *shared* and recalculated as farmers join.
Decision: A trip's route cost is split across its shipments **by weight share**, reallocated on every join, and versioned — every reallocation writes an append-only `PricingEvent` recording the previous and new amount for each farmer, and emits `trip:pricing_updated`. A shipment's price freezes at delivery. Because the amount is unknowable until the pool settles, **billing moved after delivery**: `DELIVERED → PAYMENT_PENDING → PAID → COMPLETED`, with Razorpay signature and webhook verification unchanged.
Rationale: Charging upfront would mean quoting a number we know will change — which is exactly what ADR-008 did. Weight is the fairest simple basis: it consumes the scarce resource and every farmer already understands it. Verified: one farmer alone pays ₹10,084; with two others aboard the same route, ₹2,521 — **75% less**, and the three shares sum to the route cost rather than triple it.
Alternatives considered: Splitting evenly — a 50kg load would subsidise a 900kg one. Splitting by distance-travelled — needs per-leg attribution and an optimiser, which §5 rules out for a hackathon. Keeping payment upfront with a later adjustment — two money movements per farmer, and a refund path on every join.

## ADR-032: One open trip per vehicle, enforced by a unique index
Date: 2026-08-29
Status: Accepted
Context: The failure tests caught a real overload. Capacity was checked per **trip**, but nothing stopped one vehicle having several open trips — so two farmers each opened their own trip on the same 1500 kg tempo with 900 kg apiece, and both passed their own per-trip check. 1800 kg was booked onto a 1500 kg vehicle.
Decision: `Trip.openForVehicle` holds the vehicle id while the trip is open and is cleared when it completes or cancels, under a unique sparse index. Selecting a transporter joins that vehicle's open trip, or creates the one open trip; a load bound for a different mandi is refused rather than silently opening a second trip.
Rationale: The vehicle is the scarce resource, not the trip, so the uniqueness has to live on the vehicle. Putting it in a unique index makes it a database guarantee that survives concurrent transactions — a check in application code would have raced exactly the way the original bug did.
Alternatives considered: A partial index filtered on `state` — `$in` support in partial filters varies by server version, and a plain sparse field is easier to reason about. Application-level locking — the bug this fixes *was* an application-level check.

## ADR-033: Reservations serialise on the trip document, because two inserts never conflict
Date: 2026-08-29
Status: Accepted
Extends: ADR-032
Context: ADR-032 stopped one vehicle having several open trips, but a race survived *inside* a single trip. `selectTransporter` runs in a transaction and re-reads `TripShipment` to re-check capacity before inserting — which reads correctly but proves nothing. Two farmers confirming at the same instant each **insert a different shipment**, and MongoDB's concurrency control is per document: no document is written by both, so no write conflict is raised, both transactions re-check against the same pre-race committed total, and both commit. A new end-to-end suite reproduced it exactly — 1.5 t + 1.5 t confirmed into the last 1.5 t of a 4 t truck, leaving 5.5 t booked. Snapshot isolation does not prevent phantom inserts, so the transaction was never going to catch this on its own.
Decision: Before the capacity re-check, the transaction bumps `Trip.reservationSeq` with a conditioned `findOneAndUpdate`. The counter carries no domain meaning; it exists so that every reservation for a trip writes one shared document and the second writer conflicts. `asPoolingError` already maps a write conflict to `CONCURRENT_BOOKING`, so the loser gets the correct closed error code and nothing is half-written.
Rationale: Capacity stays **derived from shipments** — introducing a stored `committedKg` counter would have created a second source of truth that drifts every time a shipment is delivered or cancelled. A pure serialisation token adds contention without adding state. Verified: two simultaneous confirmations for the last space now yield exactly one winner, one `CONCURRENT_BOOKING`, and a vehicle at 4000/4000 kg.
Alternatives considered: A stored `reservedKg` counter with a conditioned decrement — atomic, but duplicates the truth `capacityOf()` derives and must be reconciled on every state change. `readConcern: 'snapshot'` — does not help; the problem is phantoms, not stale reads. Optimistic retry on the client — pushes a correctness guarantee into the app, where CLAUDE.md forbids it.

## ADR-034: Five product areas per role, behind a bottom navigation
Date: 2026-08-29
Status: Accepted
Context: Neither role had any navigation. `(farmer)` and `(transporter)` were bare stacks whose entry screen was the only reachable hub, so every feature had been pushed onto it: the transporter dashboard alone carried availability, capacity, earnings, the load pool, open claims, the vehicle record and the payouts link on one scroll. Profile did not exist for either role, there was no way to sign out anywhere in the app, and Bookings, Support, Trips and Earnings had no home. The approved Stitch exports (`f1_farmer_home`, `transporter_dashboard`) both draw a five-item bottom bar that the build had simply not implemented.
Decision: `<BottomNav />` renders the five product areas per role — Farmer: Home · Bookings · Mandi · Support · Profile; Transporter: Dashboard · Requests · Trips · Earnings · Profile. Home and Dashboard keep only the greeting/status summary, whatever is live right now, and shortcuts. Sub-pages reached by a back arrow (a trip, a mandi, the request form) deliberately suppress the bar, matching the exports. Tabs navigate with `router.replace` so the back stack stays flat.
Rationale: A custom bar rather than expo-router `Tabs` because each tab needs its own nested stack and per-tab badge counts, and because the exports specify the bar's exact treatment. The information architecture is the product problem here: "everything on the dashboard" is what made a working workflow feel like a prototype.
Alternatives considered: expo-router `Tabs` with nested stacks — more moving parts than a hackathon needs, and awkward to suppress on sub-pages. A drawer — the exports show a drawer only at desktop width, which these apps never reach.

## ADR-035: Pricing by detour plus tonne-kilometres, in one backend engine
Date: 2026-08-29
Status: Accepted
Supersedes: the weight-share split in ADR-031 (the "billing after delivery" half of ADR-031 stands)
Context: ADR-031 split one route cost by weight share. An audit found three faults in that, and a fourth in how it was reached. (1) **Distance was invisible.** A farmer 225 km up the road paid the same per kilo as one 65 km from the mandi — the brief's "10 km ≠ 100 km" case produced identical rates. (2) **The route never grew.** `Trip.routeDistanceKm` was fixed at the first farmer's pickup→mandi distance and never updated, so when a distant pickup joined, the truck drove further for free and the farmers already aboard silently paid for the newcomer's detour. (3) **A delivered load's share was abandoned.** `reallocate` split the *whole* route cost among only the not-yet-frozen shipments, so each delivery raised the bill of everyone still aboard. (4) **Three formulas produced a price.** `quoteForJoining` quoted offers, `allocateByWeight` allocated them, and `poolForTransporter` reported `routeCost(distanceKm, rate)` — the gross fare, no commission deducted — as the driver's earning. The number a farmer accepted was not the number they were allocated, and the driver's "you earn" contradicted both.
Decision: One engine, `priceTrip`, is the only place a rupee is decided. A trip is the chain `P₁ → … → Pₙ → mandi`; its cost is `effectiveRouteKm × ratePerKm` and is split in two physically-grounded parts. **Detour**: appending a pickup lengthens the chain, and that growth is caused by exactly one farmer, who pays for it whole. **Line-haul**: what remains is the base run `P₁ → mandi`, split by **tonne-kilometres** — `tonnes × rideKm`, where `rideKm` is how far that produce actually travels on the vehicle. The two sum to the total exactly by construction, because each marginal detour is measured as the chain's own growth. `priceTrip` is pure with respect to the database, so quoting a farmer who has not joined yet runs the identical computation that will allocate them on confirmation. Delivered shipments are frozen and their bills subtracted before the remainder is shared. Reallocation now also fires when a farmer cancels and when a load is delivered, not only when one joins.
Rationale: Tonne-kilometre is the freight industry's own unit and it makes both axes the brief demands move the price at once — 0.5 t riding 20 km consumes 10 t·km, 2 t riding 100 km consumes 200 t·km. Nothing here is a tunable percentage: there is no weighting between load and distance to argue about, because multiplying them *is* the quantity being consumed. Charging detour separately is what stops a distant joiner being subsidised, and it is the one number a farmer can check against the map. Verified end to end in `tests/06_pooled_pricing.py` (42 checks): on a 4 t truck at ₹42/km, farmer A alone pays ₹9,517; with B (1.5 t) aboard, ₹3,860; with C (0.5 t) as well, ₹3,673 — and all three shares sum to the trip total the driver is shown, to the paisa, on every screen.
Alternatives considered: Keeping weight-only — the fault being fixed. A weighted blend `w·load + (1−w)·distance` — introduces exactly the arbitrary percentage the brief rules out, and `w` would be indefensible. Full VRP optimisation of the pickup order — PROMPT_1 §5 rules out an optimiser, and it would make prices non-deterministic across reruns. Charging each farmer their own solo fare and rebating the pooling saving — two money movements and a rebate path per join.

## ADR-036: `/trips/mine` is registered before `/trips/:id`
Date: 2026-08-29
Status: Accepted
Context: The entire transporter Dashboard and Trips tab rendered "Something needs your attention — We could not find that." `poolRouter.get('/trips/:id')` was registered above `poolRouter.get('/trips/mine')`. Express matches in registration order, so `GET /pool/trips/mine` resolved as the parameter route with `id="mine"`, `Trip.findById('mine')` threw a Mongoose `CastError`, and the error middleware — correctly — mapped that to `RESOURCE_NOT_FOUND`. Every layer behaved exactly as designed; the ordering was the whole bug. It was invisible in review because both routes read fine in isolation, and invisible in testing because no suite called `/trips/mine`.
Decision: Literal path segments are registered before parameterised siblings, with a comment at the shadowed route saying why it must stay there. `tests/06_pooled_pricing.py` calls `/pool/trips/mine` and asserts on its payload, so a future reordering fails a test rather than a demo.
Rationale: A guard in the handler (`if (id === 'mine')`) would work but leaves the trap for the next literal route added under the same prefix. Ordering is the actual contract Express offers, so the fix belongs there.
Alternatives considered: Renaming to `/trips?mine=1` — a query flag on a collection route is arguably cleaner REST, but it is a breaking client change for a bug whose fix is moving twenty lines.

## ADR-037: A transporter's name is collected at onboarding, not inferred
Date: 2026-08-29
Status: Accepted
Context: The transporter profile showed a phone number where a name belongs, and the farmer's comparison screen offered drivers called "Transporter". `requestOtp` upserts a user with `{ phone }` and `$setOnInsert: { role }` — no name, correctly, because at OTP time nobody has typed one. Farmers then pass through `/(auth)/farmer-details`, which collects it. Transporters went `verify → vehicle-register → kyc`, and **no screen on that path ever asked**, so `User.name` stayed `''` for the life of the account. The database was not corrupt and the API was not wrong: the onboarding flow simply had a hole in it.
Decision: `/(auth)/vehicle-register` collects the driver's name and `PATCH /users/me` writes it before the vehicle is registered — identity first, since a vehicle with no driver behind it is what every downstream screen was rendering. For accounts created before this, the transporter Profile shows an explicit "Add your name" action and a "Your name" settings row instead of falling back to the phone number.
Rationale: The fix has to be a place to enter the name, not a fallback that invents one — a screen-level default would have hidden the missing field from every account permanently and put a fabricated identity in front of farmers choosing who to trust with their produce. The repair path is the driver's own, so no migration guesses at anybody's name.
Alternatives considered: Backfilling names from the phone number — fabricates identity. Blocking the app until a name exists — a hard gate on drivers already mid-trip, for a field that is cosmetic until a farmer is comparing offers.

## ADR-038: Farm machinery is its own module, and a provider is anyone who owns a machine
Date: 2026-08-29
Status: Accepted
Context: V2 extends KisanPool beyond produce transport into hiring farm machinery. The tempting shortcut was to model a hire as another `TransportRequest` with a different category — one request pool, one matching engine, one lifecycle. It does not survive contact with the domain. A machine hire has no route, no cargo and no destination; it is not pooled, because two farmers cannot share one tractor-hour the way they share a truck; it is quoted per hour, per acre, per day or per job rather than per kilometre; and its scarce resource is a *time window*, not kilograms. Forcing it through Trip/TripShipment would have produced a trip with no route, a shipment with no produce, and a pooled price split across nobody.
Decision: A separate module (`modules/machinery`) with two models. `FarmMachine` is one hireable machine; `MachineBooking` is one hire of it in one window, and those rows **are** the availability calendar — a machine is free when nothing in `OCCUPIES_SCHEDULE` overlaps and no owner blackout covers it. Pricing is one backend function over four units (`PER_HOUR`, `PER_ACRE`, `PER_DAY`, `PER_JOB`): `max(rate × billableUnits + travel, minimumCharge)`, with travel charged both ways because the machine must get home. **A provider is any `User` who owns a `FarmMachine`** — not a new role, and no change to ADR-002. A `REQUESTED` booking HOLDS the slot, which is the deliberate inverse of a transporter's offer (ADR-030): there is no pool of providers to compare afterwards, so leaving it unheld would mean telling two farmers the same Tuesday morning is free.
Rationale: Provider-ness as data rather than a JWT claim is what makes the resource-utilisation story possible at all — the tractor that works twenty days a year belongs to a *farmer*, and a role gate would have locked out the exact supply the feature exists to unlock. Deriving availability from bookings reuses the reasoning that keeps V1's vehicle capacity honest (ADR-030): no counter, no calendar table, nothing to drift. The slot race is prevented by bumping `FarmMachine.reservationSeq` inside the booking transaction, which is ADR-033's fix applied unchanged — two `INSERT`s conflict on nothing, so the writers must touch one shared document for either to lose. Verified in `tests/07_farm_machinery.py` (43 checks): concurrent requests for one slot yield exactly one winner and one `CONCURRENT_BOOKING`, per-hour and per-acre units bill correctly, and a cancelled booking genuinely frees the slot.
Alternatives considered: A `MachineAvailability` calendar collection — a second source of truth that must be reconciled on every booking, cancellation and blackout. A `PROVIDER` role — breaks ADR-002's permanent single role and excludes farmer-owners. A generic "service request" shared with transport — the four differences above are all load-bearing, so the shared abstraction would have been a union type with most fields null.

## ADR-039: The return journey is a leg of the trip, not a second trip
Date: 2026-08-29
Status: Accepted
Extends: ADR-030, ADR-032, ADR-035
Context: V1 pools farmers so a vehicle reaches the mandi full, and then says nothing about the 220 km home. That run is diesel, driver time and tyre wear earning zero, and it is priced into every farmer's outbound share whether anyone admits it or not. V2 sells it. The obvious model — a second `Trip` for the homeward direction — collides immediately with ADR-032's unique index on `openForVehicle`, and collides *correctly*: the vehicle is genuinely not free to start another trip, because it is in the middle of this one.
Decision: `Trip.returnLeg` is a subdocument with its own small state machine (`NONE → OPEN → LOADING → IN_TRANSIT → COMPLETED`). It can only be opened once **every** outbound shipment has left the vehicle, which is the single mechanism guaranteeing a backhaul never competes with the produce trip — there is physically nothing of the farmers' left aboard to compete with. `BackhaulRequest` is a return load that exists independently of any farmer produce request (`requesterId` is any user, so a shopkeeper and a farmer post the same way, with no third role); `BackhaulBooking` joins one to a leg, with a unique index on `requestId` so one load can only ever ride once. Return-leg pricing is `detourKm × rate + carryKm × rate × (weight / capacity)` — the detour charged whole to the load that caused it, the carriage charged in proportion to the capacity consumed. Cargo eligibility is a whitelist per category in `shared/backhaul.ts`, enforced server-side at both list and accept time.
Rationale: The pricing deliberately reuses ADR-035's two-part shape — own-detour plus a share of the shared run — because it is the same economic argument in the other direction, and because it is the only way to sell a cheap return without lying. "Free return" would be a lie that costs the driver diesel; the discount here is structural, not invented: the vehicle was already covering the homeward run, so the second term is a fraction of a journey the outbound farmers effectively paid to position. The eligibility whitelist is conservative on purpose — `TRACTOR` is excluded from every long-haul category because a tractor-trolley is a farm vehicle not registered for commercial highway carriage in most states, and anything needing a licence we cannot verify (agrochemicals, fuel, cold chain) is simply absent, because an absent category cannot be booked by mistake. Verified in `tests/08_backhaul.py` (47 checks): the leg refuses to open with produce aboard, a tractor is refused construction material, two drivers racing one load yield exactly one winner, and a completed round trip reports 99% utilisation with the empty kilometres recovered stated explicitly.
Alternatives considered: A separate `Trip` per direction — breaks ADR-032, and makes "one vehicle, one journey" two rows that can disagree. A generic `TripLeg` collection with N legs — more general than a hackathon needs, and out-and-back is the only shape that exists. Reusing `TransportRequest` for return cargo — it requires a crop type and a farmer, and drags the compare-and-select pooling lifecycle into a flow where there is exactly one driver to offer it to. Charging a flat percentage discount off the outbound rate — an invented number, and it would price a 2 km detour the same as a 30 km one.

## ADR-040: The farmer's Active Trip screen distinguishes a solo trip from a pooled one, and prices move as one payload
Date: 2026-08-29
Status: Accepted
Extends: ADR-035
Context: A farmer alone on a still-forming trip saw a "your share" card built for pooling: a struck-through solo price identical to the share, "Pooling saves you ₹0 (0%)", and a "Share of the shared run" line equal to the whole trip cost. Every number was correct — a lone farmer genuinely carries the whole route (ADR-035) — but the screen presented a correct solo trip as if pooling had failed, and it was missing the breakdown the design calls for (total pooled load, pricing version, prior-solo line, how the share was worked out). Compounding it, the `trip:pricing_updated` socket handler mutated only that shipment's `allocatedPrice`, while the headline and the breakdown card read from the stale `pricing` objects — so when a second farmer joined with the screen open, the number did not move until an unrelated `trip:capacity` event happened to trigger a full refetch. The engine was never at fault; `tests/06_pooled_pricing.py` (42 checks) passes untouched.
Decision: `PricingUpdatedEvent` now carries the whole re-priced `TripPricingDTO` (`pricing`), which `reallocate()` already returns; all three emit sites (join, deliver, cancel) pass it. The farmer screen applies that DTO in place — headline share, trip total, pricing version and every other farmer's row together — and keeps `updates[]` only for the "your cost dropped" nudge and older clients. The share card branches on `poolSize > 1`: a solo trip says "you have this vehicle to yourself — your share drops as farmers join" with no strikethrough and no "0% saved"; a pooled trip shows the full table (total trip cost, farmers sharing, total pooled load, your load, route distance, your ride km, your detour, your slice of the shared run, "if you went alone", your share) plus the tonne-kilometre explanation. The strikethrough only renders when `solo > share`.
Rationale: The bug report read as "cost sharing is broken" but the data was right — the fix had to be in what the screen says about a state it was mislabelling, plus closing the staleness window that made a live re-split invisible. Shipping the full DTO on the event is what makes "the farmer watches the number drop" literally true again without a refetch, and it keeps the farmer and transporter screens showing the same version at the same instant. No second price is computed on the client; every figure is a field of the backend result (ADR-035's single-engine rule is unchanged).
Alternatives considered: Only editing the copy — leaves the live-update staleness, and the screen would still show a pooling breakdown for one farmer. Refetching the whole trip on every `trip:pricing_updated` — works, but throws away the in-place update that makes the drop visible and adds a round trip on every join. A separate "solo" component — the two states share almost every row; a `poolSize` branch inside the one card is less to keep in sync.

## ADR-041: Predictive Insights is a deterministic risk engine, advisory only, behind a swappable service
Date: 2026-08-29
Status: Accepted
Context: The brief asks for AI-assisted prediction of three operational risks — delivery delay, high-demand corridors, vehicle/trip cancellation — but also "do NOT build a large ML infrastructure" and "do NOT fake machine-learning claims". An audit of the data showed enough real signal for rules and not enough labelled history for a model: route distance, trip progress vs elapsed time, pickup counts, GPS freshness, a transporter's own completed/cancelled trip counts and withdrawn-offer ratio, recent request volume per mandi, seeded completed-trip history. None of it is a training set.
Decision: A `modules/predictions` module with a pure, deterministic `engine.ts` (no database, no clock of its own — `now` is passed in) that accumulates points against named reasons; a reason is only added when its signal fired, so `reasons` is a faithful list of why. A `service.ts` gathers the real rows and shapes them into the engine's plain signal objects. Thresholds — score → LOW/MEDIUM/HIGH — live once in `packages/shared/src/predictions.ts`. Confidence is `LOW` when the inputs were too thin, and the UI shows that rather than hiding it. Routes are read-only: `GET /predictions/trips/:id` (delay for a farmer aboard; delay + cancellation for the transporter), `GET /predictions/demand`, `GET /predictions/ops` (admin), and `POST /predictions/simulate` (admin, runs the pure engine on supplied signals so tests pin behaviour without staging delayed trips). Realtime: `trip:prediction` is pushed off a GPS ping only when the delay level changes, never on every ping. Surfaced compactly and only where it helps — farmer active trip (delay, MEDIUM/HIGH only), transporter active trip (delay + cancellation), admin Live board (roll-up). Nothing here writes; nothing here can cancel a trip, move a price, reroute, reject or block. The deterministic engine stays authoritative.
Rationale: A rule engine that states its signals is honest about what it is and is checkable against the map — a farmer or an operator can see the pickup that is behind, the route that is long, the vehicle that went offline. Keeping it pure and threshold-driven makes it deterministic, which is what `tests/09_predictions.py` (37 checks) asserts: same signals → same level and same reasons, thin data → LOW at LOW confidence with a reason that says so, and a prediction read leaves the trip's pool size, total and state untouched. The `assess*` service boundary means a trained model can replace the arithmetic later with no route or screen change. The UI calls it "Predictive Insights" / "AI Risk Prediction" because the implementation genuinely runs on application data and stated rules — no screen claims a model.
Alternatives considered: A trained model now — no labelled history, and it would make the calls non-deterministic across reruns and unexplainable. Prediction cards on every screen — buries the primary flow; the brief explicitly limits placement. Recomputing on every GPS ping and pushing every time — a stream of identical cards; the level-change gate is enough. A new error code for "insufficient data" — it is not an error, it is a LOW-confidence LOW result, and the error set is closed at 25.
