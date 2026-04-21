# Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
# Multi-stage build producing an image with both enquire and enscribe binaries.
# Default CMD runs enquire. For enscribe: `docker run --entrypoint enscribe ...`

# ---- build stage ------------------------------------------------------------
FROM node:22-slim AS build

WORKDIR /app

# Copy workspace manifests first so npm ci can cache deps when only code changes
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/en-core/package.json ./packages/en-core/
COPY packages/en-quire/package.json ./packages/en-quire/
COPY packages/en-scribe/package.json ./packages/en-scribe/

RUN npm ci

# Now bring in the sources and build every workspace
COPY packages/ ./packages/
RUN npm run build

# Prune devDependencies in place — keeps per-workspace node_modules symlinks intact
RUN npm prune --omit=dev --workspaces --include-workspace-root

# ---- runtime stage ----------------------------------------------------------
FROM node:22-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends git sqlite3 curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy over the pruned install + built dist from the build stage
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages

# Both enquire and enscribe are on PATH via workspace bin linking
ENV PATH="/app/node_modules/.bin:${PATH}"

VOLUME /data/docs
VOLUME /app/config
VOLUME /app/logs

# Health check assumes streamable-http transport on the default port.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3100/health || exit 1

# Default binary is enquire with the standard config location.
# Override --entrypoint enscribe (and the CMD) to run the sibling MCP.
ENTRYPOINT ["enquire"]
CMD ["--config", "/app/config/en-quire.config.yaml"]
