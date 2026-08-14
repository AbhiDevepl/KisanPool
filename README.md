# KisanPool

## 1. What KisanPool Does

Small and marginal farmers in India often cannot fill an entire truck when moving harvest to market, so they either wait or overpay for half-empty trips. KisanPool is a prototype that matches a farmer's transport request with a nearby available vehicle that has the capacity to carry the load, and splits the trip cost between the farmer and the driver. The matching and cost-splitting are computed from real inputs (coordinates, quantity, vehicle capacity, per-km rate), not from mock data.

## 2. What's Implemented in This Repo Right Now

All items below were verified by running the server and exercising the flow over HTTP.

- **Transport request flow (end-to-end, working):**
  1. Farmer submits a transport request: crop, quantity (kg), pickup and drop-off coordinates/addresses, preferred date.
  2. The system loads available vehicles and keeps only those whose capacity can carry the requested quantity.
  3. Each compatible vehicle gets a **match score**: 60% proximity (vehicle-to-pickup distance, using the haversine formula) and 40% capacity utilization (request quantity / vehicle capacity).
  4. The top 3 matches are returned, each with a computed trip distance, total cost (`distanceKm × ratePerKm`), and the split: **60% farmer / 40% driver**.
  5. Accepting a match creates a `Match` record (`ACCEPTED`), marks the request `MATCHED`, and sets the vehicle unavailable.

- **API server** (`apps/server`): Express 5 + tRPC v11 on `http://localhost:3000`. Procedures: `healthCheck`, `transport.createRequest`, `transport.findMatches`, `transport.acceptMatch`, `transport.getMatch`, `transport.seedVehicles`. Mutations and queries use the standard tRPC HTTP protocol.

- **Data layer** (`packages/db`): Prisma ORM on a local SQLite file via the libsql driver adapter. Schema models: `TransportRequest`, `Vehicle`, `Match`, plus enums `RequestStatus`, `VehicleType`, `MatchStatus`. Data persists on disk across restarts.

- **Mobile app** (`apps/native`): Expo / React Native app with a "New Request" form and a "Matches" screen that lists each vehicle's score, distance, and cost split and lets the farmer accept a match. It talks to the server through a tRPC batch link. The app type-checks; its runtime was **not verified** here because no emulator/device was available in the build environment.

Explicitly **not** implemented: authentication (all procedures are public; there is no session), real-time anything, payments, notifications, and AI/ML matching. Matching is between a single request and a vehicle.

## 3. Tech Stack Actually Used

| Technology | Purpose | Status |
|---|---|---|
| Node.js | Runtime for API server | Implemented |
| Express 5 | HTTP server hosting tRPC middleware | Implemented |
| tRPC v11 | Type-safe RPC layer between app and server | Implemented |
| TypeScript | Shared language across all packages | Implemented |
| Zod | Input validation on tRPC procedures | Implemented |
| Prisma ORM | Data modeling and queries | Implemented |
| SQLite (libsql driver adapter) | Local database (single file) | Implemented |
| Expo / React Native | Mobile client | Implemented (runtime unverified in this environment) |
| Tailwind CSS v4 (via `uniwind`) | Mobile UI styling | Implemented |
| npm workspaces + Turborepo | Monorepo tooling | Implemented |

The following were considered in the project documentation but are **not** used in this repo: PostgreSQL, Supabase (DB + Auth), Upstash Redis, Meilisearch, Docker, Next.js, shadcn/ui. None of them appear in code or configuration.

## 4. How to Run It Locally

Requirements: Node.js and npm (development uses `packageManager: npm@11.7.0`; the server runs with `tsx` and was verified on Node 22). Run from the repository root:

```sh
npm install --legacy-peer-deps
npm run db:push
cp apps/server/.env.example apps/server/.env
npm run dev:server
```

- `npm install --legacy-peer-deps` is required because of a peer-dependency conflict between `heroui-native` and `react-native-gesture-handler`; a plain `npm install` fails.
- `npm run db:push` creates the SQLite database at `packages/db/prisma/dev.db`.
- `npm run dev:server` starts the API on `http://localhost:3000`.

Verify the server is up:

```sh
curl http://localhost:3000/
# OK
```

**Environment variables** (copied from `apps/server/.env.example`):

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | `file:./dev.db` | Required by env validation; the Prisma client actually connects to a fixed local file `packages/db/prisma/dev.db` |
| `CORS_ORIGIN` | `http://localhost:8081` | Allowed origin (Expo/Metro default); must be a valid URL |
| `NODE_ENV` | `development` | Optional, defaults to `development` |

No secrets or API keys are required.

**Drive the demo flow over HTTP** (these commands were used to verify the implementation):

```sh
# 1. Seed 4 demo vehicles
curl -X POST http://localhost:3000/trpc/transport.seedVehicles -H "Content-Type: application/json"

# 2. Create a transport request
curl -X POST http://localhost:3000/trpc/transport.createRequest -H "Content-Type: application/json" \
  -d '{"farmerId":"farmer-1","cropType":"Wheat","quantityKg":800,"pickupLat":28.6139,"pickupLng":77.209,"dropoffLat":28.7041,"dropoffLng":77.1025,"pickupAddress":"Delhi Mandi","dropoffAddress":"Gurgaon Warehouse","preferredDate":"2026-08-16T10:00:00.000Z"}'

# 3. Copy the returned id, then find matches (URL-encoded {"requestId":"<id>"})
curl "http://localhost:3000/trpc/transport.findMatches?input=%7B%22requestId%22%3A%22<id>%22%7D"

# 4. Accept the top match
curl -X POST http://localhost:3000/trpc/transport.acceptMatch -H "Content-Type: application/json" \
  -d '{"requestId":"<id>","vehicleId":"<vehicleId from step 3>"}'
```

**Mobile app:** `npm run dev:native` starts Expo Router/Metro. The app talks to the API at `http://localhost:3000`; set `EXPO_PUBLIC_SERVER_URL` in `apps/native/.env` if the server runs elsewhere. As noted above, the app's runtime was not verified in this environment.

**Typecheck:** `npm run check-types` runs TypeScript across all workspaces.

## 5. Project Structure

```text
KisanPool/
├── apps/
│   ├── native/          # Expo / React Native mobile app (screens, tRPC client)
│   └── server/          # Express + tRPC HTTP server (entry: src/index.ts)
├── packages/
│   ├── api/             # tRPC router: transport matching + cost-split logic
│   ├── config/          # Shared TypeScript base configs
│   ├── db/              # Prisma schema, SQLite client, prisma.config.ts
│   └── env/             # Typed environment validation (server + native)
├── docs/                # Project documentation (PDF, architecture diagrams, screenshots)
├── package.json         # Workspace + orchestration scripts (turbo)
├── turbo.json
└── README.md
```

Key folders: `apps/server` is the HTTP entry point, `packages/api` contains the business logic (matching and cost split), `packages/db` owns the schema and database client, and `apps/native` is the mobile client.

## 6. What's Planned Next

These are **planned**, not implemented in this repo:

- **PostgreSQL + Supabase** — replace the local SQLite file with hosted Postgres; the Prisma schema is portable.
- **Supabase Auth** — farmer/driver login and per-user request ownership (the API currently accepts an arbitrary `farmerId` and all procedures are public).
- **Upstash Redis** — queue/caching for match evaluation at scale and rate limiting.
- **Meilisearch** — full-text search over mandis, crop names, and addresses.
- **Docker Compose** — one-command local environment for judges/CI.
- **Next.js + shadcn/ui web frontend** — the current client targets Expo/React Native; a web frontend is a candidate direction.
- **Fixes** — resolve the `heroui-native` peer-dependency conflict so a plain `npm install` works; add a test suite for the matching and cost-split functions.
