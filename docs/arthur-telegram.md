# Arthur Telegram Gateway

## Architecture

```text
Telegram
    ↓
Arthur Telegram Gateway (long polling)
    ↓
Arthur v1 Orchestrator
    ↓
Skills (Purchasing, Knowledge)
    ↓
AI Provider / Synthesizer
    ↓
Answer
    ↓
Telegram
```

Telegram is **only a transport layer**. No business logic lives in the Gateway.

## Why long polling

Webhook requires a public HTTPS endpoint and certificate management. Long polling:
- works from any server;
- needs no reverse proxy or TLS termination;
- reconnects automatically;
- is easier to run behind Docker Compose.

The Gateway uses Telegram `getUpdates` with a long timeout and an outer restart loop.

## Required environment variables

Copy `docker/arthur/.env.example` to `docker/arthur/.env` and fill in:

```bash
# From @BotFather
TELEGRAM_BOT_TOKEN=replace-with-real-bot-token

# Comma-separated Telegram user IDs allowed to use Arthur
TELEGRAM_ALLOWED_USER_IDS=replace-with-owner-telegram-user-id
```

Optional:

```bash
TELEGRAM_POLL_TIMEOUT_MS=30000
TELEGRAM_API_TIMEOUT_MS=10000
TELEGRAM_API_RETRY_ATTEMPTS=3
TELEGRAM_GATEWAY_HEALTH_PORT=8788
TELEGRAM_GATEWAY_LOG_LEVEL=info
```

## Commands

- `/start` — greeting and list of supported requests.
- `/help` — same as `/start`.
- `/status` — Gateway status, uptime, processed updates, last error.

## Supported natural-language requests

- "Артур, что сейчас с закупщиком?"
- "Покажи спорные позиции."
- "Какой последний заказ?"
- "Что мы решили по матрицам?"

If data is unavailable, the response says so explicitly. No fabrication.

## Read-only scope

Through Telegram you can only:
- read purchasing status;
- read owner review items;
- read final order summary;
- read knowledge search results.

You cannot:
- change Owner Decisions;
- approve/reject items;
- send supplier orders;
- change matrices;
- change budgets.

## Docker Compose

The Gateway is a service in `docker/arthur/compose.yml`:

```yaml
  telegram-gateway:
    build:
      context: ../..
      dockerfile: docker/arthur/Dockerfile.telegram
    restart: unless-stopped
    environment:
      TELEGRAM_BOT_TOKEN: ${TELEGRAM_BOT_TOKEN}
      TELEGRAM_ALLOWED_USER_IDS: ${TELEGRAM_ALLOWED_USER_IDS}
    ports:
      - "127.0.0.1:8788:8788"
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:8788/health')..."]
```

## First launch

```bash
cd docker/arthur
cp .env.example .env
# edit .env with real TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_USER_IDS
docker compose up -d telegram-gateway
```

## After reboot

Because the service uses `restart: unless-stopped`, Docker Compose will start it automatically if the Docker daemon is configured to start on boot.

## Logs

```bash
docker logs -f arthur-core-telegram-gateway-1
```

## Status check

```bash
curl http://127.0.0.1:8788/health
```

## Stop

```bash
cd docker/arthur
docker compose stop telegram-gateway
```

## Update after git pull

```bash
cd docker/arthur
docker compose build telegram-gateway
docker compose up -d telegram-gateway
```

## n8n compatibility

The existing n8n morning brief workflow (`n8n/workflows/arthur-morning-task-brief-production.json`) continues to work independently. The Gateway handles interactive dialogue; n8n handles scheduled notifications.

## Troubleshooting

- **Gateway does not start** — check `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALLOWED_USER_IDS` in `.env`.
- **No response in Telegram** — check logs for `telegram_user_rejected`; the user ID may not be in `TELEGRAM_ALLOWED_USER_IDS`.
- **Arthur unavailable** — check that the Gateway container can reach Purchasing Agent files and fixtures.
- **High CPU** — increase `TELEGRAM_POLL_TIMEOUT_MS`.

## Files

- `agents/arthur-v1/telegram/telegram_gateway.js` — main polling loop and message handler
- `agents/arthur-v1/telegram/telegram_client.js` — Telegram Bot API client
- `agents/arthur-v1/telegram/config.js` — environment configuration
- `agents/arthur-v1/telegram/healthcheck.js` — HTTP health server
- `agents/arthur-v1/telegram/start.js` — entry point
- `agents/arthur-v1/tests/telegram_gateway.test.js` — tests
- `docker/arthur/Dockerfile.telegram` — container image
- `docker/arthur/compose.yml` — Compose service
- `docker/arthur/.env.example` — required env variables
