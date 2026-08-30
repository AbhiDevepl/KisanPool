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

## ADR-038: Transporter wallet, withdrawn to a UPI ID via RazorpayX
Date: 2026-08-29
Status: Accepted
Context: Driver earnings were sent per delivered load with a Razorpay Route transfer to a linked bank account, and payout onboarding collected PAN + account number + IFSC (ADR-007). The product now wants an internal earnings balance the driver draws down on demand, paid to a UPI ID — no bank instrument on our side.
Decision: A `TransporterWallet` holds a whole-rupee `balance` per transporter, and `markCaptured` credits it with `transporterPayoutAmount` once per settled payment (idempotent on `paymentId` via a unique partial index on the `WalletTransaction` ledger). The existing Route transfer path is left intact so nothing that depended on it breaks; in demo mode neither moves real money. Payout onboarding now takes only a UPI ID, stored on `TransporterPayoutAccount.upiId`; the legacy `bankAccountLast4`/`ifsc` columns stay for old records but are no longer written. `POST /wallet/withdraw` validates the amount (whole rupees, ≥ `MIN_WITHDRAWAL_RUPEES`, ≤ balance) and the UPI format, then debits the wallet with a conditioned atomic `$inc` (`balance: { $gte: amount }` — a lost race returns `VALIDATION_ERROR`, never an overdraft), writes a `PENDING` `Withdrawal` with a unique `referenceId`, and calls RazorpayX Payouts (`/contacts` → `/fund_accounts` vpa → `/payouts`) with `referenceId` as the `X-Payout-Idempotency` key. A failed payout call reverses the debit exactly once (`reversedAt` guard) and the row goes `FAILED`. The `payout.processed|failed|reversed` webhook settles `PENDING` rows through `applyPayoutOutcome`, which is a no-op on an already-terminal row. No new error codes: `PAYOUT_ACCOUNT_INACTIVE`, `PAYOUT_TRANSFER_FAILED`, `VALIDATION_ERROR`, `RESOURCE_NOT_FOUND`, `EXTERNAL_SERVICE_ERROR` cover it (the set stays closed, ADR-018).
Rationale: Balance is a stored counter here, not derived, because there is nothing to derive it from — earnings and withdrawals are independent events, not a function of trip state. Every balance move is one atomic `$inc` plus one ledger row, so the ledger always reconciles to `balance`. Debiting before the payout call, with a bounded reversal, means money is never sent that the wallet did not cover, and the idempotency key means a retried request cannot pay twice. With no RazorpayX key pair or source account number the withdrawal settles as a deterministic demo payout, matching how the rest of the payment stack degrades.
Alternatives considered: Keep Route transfers and skip the wallet — does not deliver the "withdraw on demand" product. Derive balance from `sum(EARNING) - sum(WITHDRAWAL)` on every read — O(ledger) per request and races with concurrent withdrawals. Hold the payout call before debiting — opens a window where two requests both see the full balance. A Mongo transaction around debit + withdrawal insert + payout — the payout is a network call to a third party and must not sit inside a DB transaction; the conditioned `$inc` already gives the atomicity that matters.

## ADR-039: Mandis are operator-created records on a map, not a shipped list
Date: 2026-08-29
Status: Accepted
Supersedes: the static `MANDIS` array in `apps/mobile/lib/mandis.ts`
Context: The farmer app shipped a hardcoded list of six Maharashtra APMC markets with invented price bands, opening hours and "registered farmers" counts. It could not be changed without an app release, it was Maharashtra-only, and the numbers were fiction presented as market data. The `GET /admin/mandis` endpoint was unrelated — it aggregated demand from real requests/trips for a console table.
Decision: A `Mandi` model holds `{ name, city, state, geo: Point, crops[], active }` with a `2dsphere` index. The operator console's Mandis tab is a Leaflet map: click to set a location, fill name/city/state/crops, "Add to batch" to stage several, "Save all" writes them in one `POST /admin/mandis` with `{ mandis: [...] }`. `PATCH`/`DELETE` toggle `active` and remove. The farmer app fetches `GET /mandis?lat&lng&radiusKm` — a `$near` query returning only `active` mandis within the radius (default 150 km), nearest first — and `GET /mandis/:id` for the detail screen. `lib/mandis.ts` keeps its helper surface (`rankMandis`, `findMandi`, geo utils) but reads a fetched-and-cached list instead of a constant; screens that showed price bands / hours now hide those sections, since an operator mandi carries neither. No new error codes: `RESOURCE_NOT_FOUND` and `VALIDATION_ERROR` cover it (set stays closed, ADR-018).
Rationale: "Where can I sell" is operational data an operator owns, not a constant a build carries — putting it on a map is the natural authoring surface, and a `$maxDistance` query is the natural read. Bulk create matters because an operator onboarding a new district adds ten markets at once, not one. The old demand-analytics `GET /admin/mandis` is left in place but shadowed by the new sub-route mount; it can be deleted in a later pass.
Alternatives considered: Keep the static list and let the operator only toggle visibility — does not let them add a market, which is the whole request. Store `lat`/`lng` as plain numbers and filter in JS — fine at demo scale but throws away the index the moment the list grows; `2dsphere` costs nothing now. A separate `/admin` mount for mandi CRUD — Express route-order made a sub-path mount (`/admin/mandis` before `/admin`) the smaller change.

## ADR-042: KYC documents encrypted at rest, served through an authed decrypt route
Date: 2026-08-30
Status: Accepted
Context: In demo mode (no `CLOUDINARY_URL`) KYC documents — RC, DL, PAN — were written as plaintext image files under `apps/server/uploads/kyc/<userId>/` and served by `express.static('/uploads')` to anyone with the URL. The URL is a stored `KycDocument.fileUrl`, so a leaked link or a directory listing exposed a transporter's identity papers with no auth check.
Decision: `uploadFile` now encrypts the buffer with AES-256-GCM before writing it locally; files carry a `.enc` extension and the layout `[12-byte IV | 16-byte auth tag | ciphertext]`. The key is `SHA-256(config.uploadsEncryptionKey)`, where the secret is `UPLOADS_ENCRYPTION_KEY`, falling back to `JWT_SECRET` then a dev constant. `/uploads/kyc` is removed from static serving (returns 404); the file is reachable only through `GET /documents/file/*` (`requireAuth`), which decrypts on the fly and streams it `inline` with `Cache-Control: private, no-store`. A transporter may read only paths under `kyc/<their own id>/`; an admin (`isAdmin` on the token, now surfaced by `requireAuth`) may read anyone's. The operator console fetches with its bearer token and opens the decrypted blob instead of linking the raw URL. Cloudinary-hosted docs keep their absolute HTTPS URL and never touch this route. No new error codes: `AUTH_FORBIDDEN`, `RESOURCE_NOT_FOUND`, `VALIDATION_ERROR` cover it (set stays closed, ADR-018).
Rationale: The files are only ever read by their owner or an operator reviewer, so a per-request authed route is the right gate and encryption at rest means a filesystem or backup leak yields ciphertext, not identity documents. GCM gives tamper detection for free — a modified file fails the auth-tag check rather than decrypting to garbage. Keying off an existing secret keeps demo setup zero-config while allowing a dedicated key in production.
Alternatives considered: Signed time-limited URLs on the static mount — still serves plaintext from disk, and the signing key becomes the same secret we would key encryption with. Encrypting only the filename / storing files outside the web root — obscurity, not protection, against a disk-level leak. Full Cloudinary in demo mode — needs an account, which the whole local-uploads path exists to avoid.

## ADR-043: Servo AI gains read-only lookup tools and renders results inline; typed fallback
Date: 2026-08-30
Status: Accepted
Context: Servo AI could only extract intent for the six transaction tools and reply with a sentence. A farmer asking "where can I sell nearby" or "which trucks are around" got a follow-up question, not an answer, and the whole flow was unreachable without a `SARVAM_API_KEY` because `/ai/stt` throws `AI_TOOL_ERROR` with no key — there was no non-voice way in.
Decision: Two read-only tools are added to the AI contract (now eight, still closed, ADR-014): `findNearbyMandis` and `findNearbyTransporters`. Both take the farmer's saved `defaultLocation` as origin (they refuse with `AI_INTENT_UNCLEAR` if none is set), never a spoken place. `findNearbyMandis` is a `$near` on the `Mandi` 2dsphere index; `findNearbyTransporters` filters `Vehicle` on the same gate matching uses (`status: ONLINE`, `verificationStatus: VERIFIED`, spare capacity) then haversine-filters by radius in JS since `currentLocation` has no geo index. Neither changes state, so neither needs a spoken yes. The server shapes each result into `AiCard[]` on `AiChatResponse` — `mandiList` / `transporterList` and a non-interactive `map` card — which the app renders under the text reply via a new `AiChatCards` component (`react-native-maps`, already a dependency). `navigationFor` is unaffected: these results carry an `origin` key, not `handoff` or `_id`+`state`, so the assistant shows the data in place rather than navigating. The system prompt now lists every tool with its purpose and args. The voice modal gains a `TextInput` send row, always visible, which posts to `/ai/chat` — the one path that works with zero third-party keys, since `decide()` already falls back to `ruleBasedIntent`. Rule-based intent gets keyword branches (mandi/market/sell/मंडी, nearby+truck/transporter/जवळ) for the two new tools. No new error codes.
Rationale: "Where do I sell" and "who can carry it" are read-only questions the DB can already answer — making them tools, not conversation dead-ends, is what turns the assistant into a small agent. Keeping them read-only means no confirmation friction and no Golden-Rule risk: the model still never states a mandi or a price it did not get from a tool. Rendering the answer as a card with a map is the difference between "there are 3 mandis" and the farmer seeing which one and how far. The typed input is not a nice-to-have — without it the feature is dark on any server without a Sarvam subscription, which includes local dev and the demo.
Alternatives considered: A generic "query" tool the model parameterises freely — reopens the closed tool set and lets the model shape DB reads. Returning raw JSON for the app to format — puts mandi/price presentation logic in the client, which then drifts from what the server knows. A geo index on `Vehicle.currentLocation` — worth doing later; at demo scale the JS filter over online vehicles is a handful of docs. Voice-only, document the Sarvam key as required — leaves the headline feature non-functional in every keyless environment.
