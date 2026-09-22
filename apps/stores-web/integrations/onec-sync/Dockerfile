FROM node:24.7.0-alpine3.22
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY server.mjs ./server.mjs
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
