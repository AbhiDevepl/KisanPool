# KisanPool — Documentation Generation Prompt (for Claude Code)

> Yeh file directly Claude Code me paste karni hai — coding shuru karne se **pehle**. Iska kaam hai: `KisanPool_MVP_Build_Prompt.md` (jo already ready hai) ko padhkar usme se PRD, Architecture, Design, Decisions jaisi saari planning/reference files nikaalna, taaki aage jab bhi tum ya Claude Code code likhe/update kare, use "source of truth" milti rahe — baar-baar sab kuch dobara explain na karna pade.
>
> Yeh prompt khud English me hai (agent ke liye precise instructions dena zaroori hai), lekin tumhe sirf isse copy-paste karna hai — likhna kuch nahi.

---

## Prompt to paste into Claude Code

```
You are setting up a new repository for KisanPool BEFORE any application code is written.

Read `KisanPool_MVP_Build_Prompt.md` in this repo/folder in full — it is the single source
of truth for scope, tech stack, data model, API contracts, matching logic, payments, and
the voice assistant. Do not invent new scope beyond it. Where something in it is genuinely
ambiguous, make the most reasonable decision yourself and record it (with your reasoning)
in docs/DECISIONS.md instead of stopping to ask.

Create a `docs/` folder and generate the following files. Each one should be derived from
the MVP brief, organized and expanded into proper reference-document form — not a copy-paste
of the brief, but not inventing facts the brief doesn't support either.

────────────────────────────────────────
1. docs/PRD.md — Product Requirements Document
────────────────────────────────────────
Sections:
- Problem statement (why KisanPool exists — the transport/half-empty-truck problem for
  small farmers, in 2-3 sentences)
- Users & personas: Farmer, Transporter — one short persona paragraph each (context, pain
  point, what success looks like for them)
- Goals & success metrics for the MVP (e.g. request-to-match time, payment success rate,
  % of trips completed without a dispute, repeat usage)
- In-scope features for this MVP (pull directly from the brief's feature set: request
  creation, matching, payment/payout, live tracking, ratings, KYC gating, voice assistant)
- Explicitly out-of-scope for this MVP (multi-role accounts, wallet/stored value,
  full GST invoicing, international payments, admin dashboard UI — call out that admin
  actions are manual/API-only for now)
- User stories, grouped by role, in "As a [role], I want to [action], so that [outcome]"
  format — cover at minimum: request creation, viewing matches, accepting + paying,
  live tracking, chat/call, rating, cancellation, KYC onboarding, voice assistant usage
- Non-goals / explicit constraints (e.g. India-only, INR-only, phone-based auth only)

────────────────────────────────────────
2. docs/ARCHITECTURE.md — System Architecture
────────────────────────────────────────
Sections:
- One high-level diagram (ASCII is fine) showing: Expo app <-> Express/Socket.io backend
  <-> MongoDB, and the three external integrations (Sarvam AI, Razorpay, Google Maps)
  as separate boxes off the backend
- Component responsibilities: mobile app, auth module, matching service, payment service,
  realtime/socket layer, AI layer, notification layer — one paragraph each, referencing
  the module folders from the brief's repo layout
- End-to-end sequence for the core flow (farmer creates request -> matches -> accept ->
  payment -> booking confirmed -> live tracking -> delivery -> payout -> rating), written
  as a numbered sequence, not just a diagram
- The Golden Rule from the brief, verbatim: "AI understands -> Backend decides ->
  Matching engine calculates -> Payment settles it -> Database records everything ->
  Frontend presents" — and one paragraph on what it rules out (LLM writing to the DB,
  LLM inventing prices/ETAs, client-only payment confirmation)
- Security & trust boundaries: JWT auth on every route except the Razorpay webhook
  (which is authenticated by signature instead), where the Sarvam and Razorpay API keys
  live (server-side only), how payment signatures and webhook signatures are verified
- What is explicitly NOT built at this stage (from the brief's "what not to build" notes)
  and why — so nobody re-adds a wallet system or a custom ledger by accident later

────────────────────────────────────────
3. docs/DATA_MODEL.md — Database Schema Reference
────────────────────────────────────────
- One section per Mongoose model from the brief (User, Vehicle, Document, TransportRequest,
  Match, Payment, TransporterPayoutAccount, Rating, ChatMessage, AiSession): fields, types,
  enums, and a one-line note on what each model is for
- A short relationships list (which models reference which via ref IDs)
- Note which fields are derived/rolled-up (e.g. User.ratingAvg) rather than written directly

────────────────────────────────────────
4. docs/API_CONTRACTS.md — API & Event Reference
────────────────────────────────────────
- The success/error response envelope, verbatim from the brief
- All REST endpoints, grouped by module (auth, users, vehicles, documents, transport,
  payments, transporters/payouts, ratings, ai, maps), each with method, path, request body
  shape, and what it returns
- All Socket.io events, split into client->server and server->client, each with payload shape
  and which screen/flow triggers it
- The AI-safe tool contract (the 6 tools from the brief) — note explicitly that these tools
  call the same service functions as the REST routes, and that acceptMatch hands off to
  checkout rather than completing payment itself
- List of error codes used across the API (NO_VEHICLE_AVAILABLE, VEHICLE_CAPACITY_EXCEEDED,
  etc. — extend the list as needed but keep every code SCREAMING_SNAKE_CASE and stable)

────────────────────────────────────────
5. docs/DESIGN.md — UI/UX Design System & Screen Map
────────────────────────────────────────
- Merge the two Stitch design-token sets (farmer app's "Agri-Logistics Standard" and
  transporter app's "Agri-Tech Premium") into one documented system: colors, typography
  scale (Inter, sizes/weights), spacing (4px baseline), corner radii, elevation levels —
  note where the transporter app intentionally uses a slightly darker primary tone
- Full screen inventory table: screen name -> route -> role -> one-line purpose, covering
  every screen in the brief (onboarding, KYC, home, discovery, matches, checkout, tracking,
  chat, rating, passbook, payouts) for both roles
- Navigation map: how `(auth)` -> `(farmer)` / `(transporter)` route groups are gated by
  role after login
- Interaction notes for the three most complex flows: the checkout handoff after accepting
  a match, the live map + chat during an active trip, and the voice-assistant round trip
  (record -> STT -> chat -> TTS -> navigate)

────────────────────────────────────────
6. docs/DECISIONS.md — Architecture Decision Record (ADR) log
────────────────────────────────────────
Format each entry as:
  ## ADR-00X: <short title>
  Date: <today's date>
  Status: Accepted
  Context: <what problem/question this addresses>
  Decision: <what was decided>
  Rationale: <why, in 1-3 sentences>
  Alternatives considered: <what else was on the table, and why not>

Seed this file with an entry for each major decision the brief already makes, at minimum:
- Single Expo app with role-gated navigation, instead of two separate apps
- MongoDB/Mongoose instead of a relational database
- Socket.io for real-time instead of polling
- Sarvam AI as the single voice/language vendor instead of stitching multiple services
- Razorpay Route for payouts instead of a custom ledger/wallet
- Booking is confirmed only after payment capture, not at match-accept time
- KYC verification gates whether a vehicle appears in matching at all
- Cancellation/refund percentages as config, not hardcoded

Then add this standing instruction at the top of the file, in bold:
"New entries must be appended here any time a non-trivial technical decision is made
during implementation — do not silently decide and move on."

────────────────────────────────────────
7. docs/ROADMAP.md — Build Phases & Definition of Done
────────────────────────────────────────
- Convert the brief's build order (§12) into a checklist with one `- [ ]` per phase
- Under each phase, pull in the relevant bullets from the brief's "MVP definition of done"
  (§13) as the acceptance criteria for that phase, so a phase can be marked done only when
  its criteria are demonstrably true
- Add a final "Demo checklist" section: the minimum end-to-end path that must work live
  (one farmer request -> match -> pay -> track -> deliver -> payout -> rate)

────────────────────────────────────────
8. CLAUDE.md — repo root (auto-loaded by Claude Code every session)
────────────────────────────────────────
Keep this SHORT — it's a pointer file, not a duplicate of the docs above:
- 2-3 line project summary
- "Before making any change, check docs/ARCHITECTURE.md and docs/API_CONTRACTS.md for
  what already exists — do not re-derive scope from memory."
- The Golden Rule, verbatim
- Hard rules to never violate: no LLM writes to the DB; no payment is ever confirmed
  client-side only (webhook + signature verification required); KYC-unverified vehicles
  never appear in matching; every API response uses the { success, data|error, requestId }
  envelope
- "When you make an architecturally significant decision, append an ADR to
  docs/DECISIONS.md before continuing."
- A placeholder "How to run" section (dev server, mobile app, seed data) — fill in the
  actual commands once the repo is scaffolded, don't guess them now

────────────────────────────────────────
After generating all 8 files
────────────────────────────────────────
Print a short summary of what was created and explicitly ask whether any section should
be adjusted before moving on to actual implementation code. Do not start scaffolding the
app or server code in this same pass — this pass is planning documents only.
```

---

## Isse use kaise karna hai

1. Pehle apna `KisanPool_MVP_Build_Prompt.md` file usi folder/repo me rakho jaha Claude Code chalega.
2. Upar wala poora prompt (```` ``` ```` ke andar wala hissa) copy karke Claude Code me paste karo.
3. Yeh `docs/` folder me 7 files aur root me `CLAUDE.md` bana dega — yeh sab tumhare "PRD, design.md, architecture.md, decision-making files" hain.
4. Isके baad hi actual coding (backend/app scaffolding) wala prompt do — pehle yeh planning-docs pass complete hone do, taaki Claude Code ke paas har session me ek fixed "source of truth" rahe aur wo baar-baar apne decisions badalta na rahe.
