FROM node:22-alpine AS dependencies
WORKDIR /opt/business-kpi
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /opt/business-kpi
RUN addgroup -S businesskpi && adduser -S -G businesskpi businesskpi
COPY --from=dependencies /opt/business-kpi/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY agents/business-kpi ./agents/business-kpi
COPY apps/business-kpi-web ./apps/business-kpi-web
USER businesskpi
EXPOSE 3220
CMD ["node", "apps/business-kpi-web/server.js"]
