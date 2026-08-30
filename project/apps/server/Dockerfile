# syntax=docker/dockerfile:1

# ---------- build ----------
# Build context is the monorepo root (project/) so the npm workspace resolves
# @kisanpool/shared and @kisanpool/server together.
FROM node:20-bookworm-slim AS build
WORKDIR /repo

# Install deps against the full workspace manifest set for a cached layer.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
RUN npm ci

# Bring in the sources the server actually compiles (tsconfig rootDir is ../..).
COPY packages/shared packages/shared
COPY apps/server apps/server

RUN npm run build --workspace @kisanpool/server

# Prune to production-only dependencies for the runtime image.
RUN npm prune --omit=dev

# ---------- runtime ----------
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /repo

# tini for correct signal handling / zombie reaping of the node process.
RUN apt-get update && apt-get install -y --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/packages/shared ./packages/shared
COPY --from=build /repo/apps/server/package.json ./apps/server/package.json
COPY --from=build /repo/apps/server/dist ./apps/server/dist

# Durable recovery journal lives here when Redis is absent (config.resilience.journalFile).
RUN mkdir -p /repo/apps/server/.data && chown -R node:node /repo/apps/server/.data
WORKDIR /repo/apps/server

USER node
EXPOSE 4000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/apps/server/src/server.js"]
