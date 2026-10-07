FROM node:22-bookworm-slim

WORKDIR /app

COPY apps/minmax-mail-intake ./apps/minmax-mail-intake

ENV NODE_ENV=production \
    MINMAX_HEALTH_HOST=0.0.0.0 \
    MINMAX_HEALTH_PORT=3220

EXPOSE 3220

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD ["node", "apps/minmax-mail-intake/healthcheck.js"]

CMD ["node", "apps/minmax-mail-intake/index.js"]
