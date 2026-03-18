# Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
FROM node:22-slim

RUN apt-get update && apt-get install -y git sqlite3 curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json tsconfig.json ./
COPY src/ ./src/
RUN npm ci && npm run build && npm prune --production

VOLUME /data/docs
VOLUME /app/config
VOLUME /app/logs

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3100/health || exit 1

ENTRYPOINT ["node", "dist/index.js"]
CMD ["--config", "/app/config/en-quire.config.yaml"]
