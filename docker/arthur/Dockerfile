FROM node:22-alpine AS dependencies
WORKDIR /opt/arthur
COPY agents/arthur-core/package.json ./agents/arthur-core/package.json
RUN npm install --prefix agents/arthur-core --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /opt/arthur
RUN addgroup -S arthur && adduser -S -G arthur arthur
COPY --from=dependencies /opt/arthur/agents/arthur-core/node_modules ./agents/arthur-core/node_modules
COPY agents/arthur-core ./agents/arthur-core
COPY data/arthur/migrations ./data/arthur/migrations
COPY scripts/arthur/run-migrations.js ./scripts/arthur/run-migrations.js
USER arthur
EXPOSE 8787
CMD ["node", "agents/arthur-core/runtime/start-server.js"]
