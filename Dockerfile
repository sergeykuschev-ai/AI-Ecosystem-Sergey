FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV PURCHASING_WEB_PORT=3210
EXPOSE 3210
CMD ["node","apps/purchasing-web-backend/server.js"]
