FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY agents ./agents
COPY apps ./apps
COPY shared ./shared
COPY scripts/purchasing/container-probe-runner.js ./scripts/purchasing/container-probe-runner.js
COPY scripts/purchasing/probes ./scripts/purchasing/probes

RUN mkdir -p /app/output /app/data/purchasing

ENV NODE_ENV=production \
    PURCHASING_WEB_HOST=0.0.0.0 \
    PURCHASING_WEB_PORT=3210

EXPOSE 3210

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD ["node", "apps/purchasing-web-backend/server.js", "--healthcheck"]

CMD ["node", "apps/purchasing-web-backend/server.js"]
