# KisanPool

This file provides context about the project for AI assistants.

## Project Overview

- **Product**: KisanPool — matches farmer transport requests with available trucks and splits trip cost between farmer and driver.
- **Ecosystem**: Node.js monorepo (npm workspaces + Turborepo)

## Tech Stack

- **Server**: Node.js, Express, tRPC, Zod, TypeScript
- **Data**: Prisma ORM + SQLite (libsql driver adapter)
- **Mobile**: Expo (Expo Router), React Native, TypeScript
- **Styling**: Tailwind CSS v4 via `uniwind` + `heroui-native`

## Project Structure

- `apps/native` — Expo/React Native app (screens, tRPC client)
- `apps/server` — Express + tRPC server
- `packages/api` — tRPC router with transport matching/cost-split logic
- `packages/db` — Prisma schema + SQLite client
- `packages/env` — typed env validation
- `packages/config` — shared TypeScript config

## Common Commands

```sh
npm install --legacy-peer-deps   # install (heroui-native peer conflict workaround)
npm run db:push                  # create/migrate SQLite dev.db
npm run dev:server               # start API on :3000
npm run dev:native               # start Expo app
npm run check-types              # typecheck all workspaces
```

## Maintenance

Keep AGENTS.md updated when:

- Adding/removing dependencies
- Changing project structure
- Adding new features or services
- Modifying build/dev workflows

AI assistants should suggest updates to this file when they notice relevant changes.
