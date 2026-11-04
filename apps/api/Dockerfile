# syntax=docker/dockerfile:1
#
# Clickco API image (ADR-0008): the NestJS HTTP API and every BullMQ queue except media-export,
# which only the separate media worker consumes (Dockerfile.worker, audit H1).
#
# Build from the repository root (.dockerignore keeps the context to what this build reads):
#   docker build -f apps/api/Dockerfile -t clickco-api .
# Railway settings: apps/api/railway.json. Env, first deploy and rollback: docs/DEPLOY.md.
#
# Keep the first two stages identical to Dockerfile.worker.

ARG NODE_IMAGE=node:22.23.4-trixie-slim

# ── 1. Prune the workspace to @clickco/api and the packages it depends on ─────────────────────
FROM ${NODE_IMAGE} AS prune
WORKDIR /repo
COPY . .
RUN npx --yes turbo@2.11.10 prune @clickco/api --docker

# ── 2. Install from the frozen lockfile, build, and collect production dependencies ───────────
FROM ${NODE_IMAGE} AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo
# Manifests and lockfile first: this layer stays cached until a dependency changes.
COPY --from=prune /repo/out/json/ ./
RUN pnpm install --frozen-lockfile
COPY --from=prune /repo/out/full/ ./
RUN pnpm exec turbo run build --filter=@clickco/api \
 && pnpm --filter @clickco/api deploy --prod --legacy /out

# ── 3. Runtime: Node 22, production dependencies and dist/ only, non-root ─────────────────────
FROM ${NODE_IMAGE} AS runtime
# tini is PID 1: it forwards SIGTERM to Node, so Nest's shutdown hooks (enableShutdownHooks in
# main.ts) close the HTTP server, BullMQ workers, Redis and the Postgres pool before exit.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*
# No setuid/setgid binaries: a compromised non-root process has nothing to escalate through
# (the image-side half of no-new-privileges, which Railway cannot set; docs/DEPLOY.md).
RUN find / -xdev -perm /6000 -type f -exec chmod a-s {} +
ENV NODE_ENV=production \
    PORT=4000
WORKDIR /app
# Owned by root and not writable by the app user: the code cannot be changed at runtime.
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /repo/apps/api/dist ./dist
COPY --chmod=0755 apps/api/docker/entrypoint.sh /usr/local/bin/clickco-entrypoint
USER node
EXPOSE 4000
# Railway uses its own deploy-time check (healthcheckPath); this one serves `docker run` and any
# Docker-native host. 200 only when Postgres answers (src/health/health.controller.ts).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/clickco-entrypoint"]
CMD ["node", "dist/main.js"]
