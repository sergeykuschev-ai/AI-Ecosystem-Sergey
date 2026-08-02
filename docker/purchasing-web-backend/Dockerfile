FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY agents ./agents
COPY apps ./apps

ENV NODE_ENV=production \
    PURCHASING_WEB_HOST=0.0.0.0 \
    PURCHASING_WEB_PORT=3210

EXPOSE 3210

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3210/api/v1/health',{headers:{'x-api-key':process.env.PURCHASING_API_TOKEN}}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "apps/purchasing-web-backend/server.js"]
