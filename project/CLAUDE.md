# KisanPool

KisanPool matches a farmer's produce-transport request with a nearby verified vehicle that has spare capacity, splits the trip cost, tracks the trip live, collects payment through Razorpay and pays the transporter out automatically. One Expo app with two roles (`FARMER` / `TRANSPORTER`), one Express + Socket.io backend, MongoDB. A farmer can do the whole flow by voice in their own Indian language through "Servo AI" (Sarvam AI).

**Before making any change, check `docs/ARCHITECTURE.md` and `docs/API_CONTRACTS.md` for what already exists — do not re-derive scope from memory.**

## The Golden Rule

> AI understands → Backend decides → Matching engine calculates → Payment settles it → Database records everything → Frontend presents.

## Hard rules — never violate

- **No LLM writes to the database.** Servo AI has exactly six tools (`docs/API_CONTRACTS.md` §4); each calls the same service function the equivalent REST route calls. The user id comes from the JWT, never from speech. The model never invents a price, vehicle, ETA or booking id.
- **No payment is ever confirmed client-side only.** Server-side HMAC signature verification *and* the signature-verified Razorpay webhook are what mark a `Payment` as `PAID`. `acceptMatch` by voice hands off to the checkout screen — it never pays.
- **KYC-unverified vehicles never appear in matching.** The filter lives in the matching query, not the UI. Not even the admin console can override it — it refuses to put an unverified vehicle on the road.
- **Admin is a JWT claim, never a `User.role`.** `/admin/*` and document review require `requireAdmin`; a marketplace token gets `AUTH_FORBIDDEN`.
- **A booking confirms only after payment capture**, inside a MongoDB session with a conditioned `findOneAndUpdate` on capacity. A lost race returns `CONCURRENT_BOOKING` and refunds immediately.
- **Every API response uses the `{ success, data|error, requestId }` envelope**, errors included — REST, webhooks and socket `error` events alike.
- **Exactly 25 error codes exist, and the set is closed.** They are defined once in `packages/shared/src/errors.ts` and imported by both server and app; never declare a local copy, never emit an ad-hoc string, never add a 26th without an ADR that changes `docs/API_CONTRACTS.md` §5 first. Each code has one client behaviour — show, retry, redirect, disable or refresh.
- **One design system: the Farmer set.** Inter only; primary `#0d631b`, secondary `#2e7d32`; radii 8px (buttons/inputs), 16px (cards), 24px (banners/sheets). One `theme.ts` shared by both roles, no role-conditional styling. The Transporter "Agri-Tech Premium" fonts, colors and radii are not used anywhere (ADR-017).
- **Secrets stay server-side.** Sarvam, Razorpay secret, webhook secret, server Maps key and Cloudinary credentials never enter the app bundle. Only `EXPO_PUBLIC_*` values ship.
- **Policy numbers are config, not literals** — e.g. `PLATFORM_CANCELLATION_FEE_PCT`.

**When you make an architecturally significant decision, append an ADR to `docs/DECISIONS.md` before continuing.**

## Docs

| File | What it holds |
|---|---|
| `docs/PRD.md` | Personas, scope in/out, user stories, metrics, cancellation policy |
| `docs/ARCHITECTURE.md` | System diagram, module responsibilities, end-to-end sequence, security boundaries |
| `docs/DATA_MODEL.md` | All ten Mongoose models, relationships, derived fields |
| `docs/API_CONTRACTS.md` | REST routes, socket events, AI tool contract, error codes |
| `docs/DESIGN.md` | Merged design tokens, screen inventory, navigation map, complex-flow interactions |
| `docs/DECISIONS.md` | ADR log — append here |
| `docs/ROADMAP.md` | Build phases with acceptance criteria, demo checklist |

Original brief: `../prompt/KisanPool_MVP_Build_Prompt.md`. Stitch UI exports and design tokens: `../screen/`.

## Repo layout (target)

```
project/
  apps/
    mobile/          # Expo app — BOTH roles
      app/(auth)/ (farmer)/ (transporter)/
      components/  lib/
    admin/           # Vite + React operator console — Overview/Users/Verification/Vehicles
    server/
      src/modules/   # auth users vehicles documents transport matching
                     # payments ratings chat notifications ai realtime maps admin
  packages/shared/   # shared TS types/enums
    src/errors.ts    # the 25 error codes — single definition for server + app
  tests/             # integration suites, run against a live server
  docs/
```

## How to run

```bash
npm install                 # workspace root
cp .env.example .env        # every integration degrades gracefully if a key is blank
npm run seed                # demo farmer + 3 verified transporters + 1 KYC-pending
npm run dev:server          # Express + Socket.io on :4000
npm run dev:mobile          # Expo
npm run dev:admin           # operator console on :5173 (default login admin/admin)
npm run typecheck           # server + app + shared
npm test                    # 73 integration checks against a running server
```

Needs a MongoDB replica set for the booking transaction (Atlas, or a local `mongo:7`
container with `--replSet rs0`). Seeded logins are 9000000001 (farmer) and 9000000002–4
(verified transporters); 9000000005 is deliberately KYC-pending. OTPs print to the server
console in demo mode. Full setup, including running without third-party keys, is in
`README.md`.
