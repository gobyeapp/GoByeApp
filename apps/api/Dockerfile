# GoBye API image (BACKEND_ARCHITECTURE.md §11, docs/DEPLOYMENT_STACKSHIFT.md).
# Build from the REPOSITORY ROOT (the API compiles packages/core into itself):
#   docker build -f apps/api/Dockerfile --build-arg APP_VERSION=$(git rev-parse --short HEAD) -t gobye-api .
# The same image runs three ways:
#   API:        (default command)                     listens on $PORT (default 8080)
#   Worker:     node apps/api/dist/apps/api/src/worker.js
#   Migrations: node apps/api/dist/apps/api/src/migrate.js up   (a release step, before the new API starts)
# Secrets are never baked in: they come from the host's environment at run time.

# Pinned by the multi-architecture INDEX digest (Phase 1.5), so every build uses the same bytes even if
# the tag is re-pushed. The tag is kept for readability; Docker uses the digest.
#   node:22.23.4-bookworm-slim, Docker Hub library/node, index digest read 2026-10-23 from
#   hub.docker.com/v2/repositories/library/node/tags/22.23.4-bookworm-slim (and 22-bookworm-slim, same digest).
# To update: read the new tag's top-level "digest" from that API (not a per-architecture digest), change
# both lines below, and let CI build and smoke-test the image (.github/workflows/ci.yml, job "docker").
ARG NODE_IMAGE=node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d

# ---- 1. Install all dependencies of the API workspace (only), from the shared lock file ----
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/admin/package.json apps/admin/
COPY apps/api/package.json apps/api/
COPY apps/driver/package.json apps/driver/
COPY apps/rider/package.json apps/rider/
COPY packages/core/package.json packages/core/
COPY packages/ui/package.json packages/ui/
COPY infra/cloudflare/package.json infra/cloudflare/
RUN npm ci --workspace apps/api --include-workspace-root=false --no-audit --no-fund

# ---- 2. Compile (TypeScript → JavaScript, @gobye/core included) ----
FROM deps AS build
COPY packages/core/src packages/core/src
COPY infra/cloudflare/src/r2/sigv4.ts infra/cloudflare/src/r2/sigv4.ts
COPY apps/api/tsconfig.json apps/api/tsconfig.build.json apps/api/
COPY apps/api/src apps/api/src
RUN npm run build --workspace apps/api

# ---- 3. Production dependencies only ----
FROM deps AS prod-deps
RUN npm ci --workspace apps/api --include-workspace-root=false --omit=dev --no-audit --no-fund \
 && mkdir -p apps/api/node_modules

# ---- 4. Runtime: small, non-root, no compilers, no source ----
FROM ${NODE_IMAGE} AS runtime
ARG APP_VERSION=unknown
ENV NODE_ENV=production \
    APP_VERSION=${APP_VERSION} \
    PORT=8080 \
    HOST=0.0.0.0
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
# Packages whose version differs from another workspace's (e.g. zod) are installed under the workspace.
COPY --from=prod-deps --chown=node:node /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --chown=node:node apps/api/migrations ./apps/api/migrations
COPY --chown=node:node apps/api/package.json ./apps/api/package.json
COPY --chown=node:node apps/api/scripts/health-check.mjs ./apps/api/scripts/health-check.mjs
USER node
EXPOSE 8080
# Liveness only (no dependencies): the host restarts a hung process. Readiness (/health/ready) is for
# the load balancer / gateway and the deploy check.
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "apps/api/dist/apps/api/src/main.js"]
