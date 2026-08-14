# Arthur Telegram Gateway

## Architecture

```text
Telegram
    ↓
Arthur Telegram Gateway (long polling)
    ↓
Arthur v1 Orchestrator
    ↓
Skills (Arthur Core, Purchasing, Knowledge)
    ↓
AI Provider / Synthesizer
    ↓
Answer
    ↓
Telegram
```

Telegram is **only a transport layer**. No business logic lives in the Gateway.

## Network topology

The Gateway is attached to two Docker networks:

- `arthur_internal` — internal-only network for Arthur Core services (PostgreSQL, API). No outbound Internet access.
- `arthur_outbound` — regular bridge network that allows outbound Internet access to `api.telegram.org`.

PostgreSQL and Arthur API remain on `arthur_internal` only and are not exposed to the Internet. n8n continues to use `arthur_n8n`.

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

# Canonical Arthur Core profile; never use a Telegram user ID here
ARTHUR_OWNER_PROFILE_ID=sergey
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

- "Позвонить поставщику завтра"
- "В пятницу проверить цены Award"
- "Срочно написать бухгалтеру"
- "Создай задачу позвонить поставщику завтра"
- "Добавь задачу проверить цены Award в пятницу"
- "Поставь мне задачу подготовить документы до 18 августа"
- "Что у меня по задачам?"
- "Что у меня сегодня?"
- "Артур, что сейчас с закупщиком?"
- "Покажи спорные позиции."
- "Какой последний заказ?"
- "Что мы решили по матрицам?"

If data is unavailable, the response says so explicitly. No fabrication.

### Task creation rules

Task creation is deterministic and uses the existing `ArthurCoreSkill` and
`POST /v1/tasks`. The Core owner is always the configured canonical profile
(`sergey` in production), never the Telegram user ID. Created Telegram tasks
use domain `personal`, `sourceType=telegram`, and the Telegram update ID as
`sourceRef` when it is available. Core writes the task and its `task.create`
audit event atomically.

Short task-like phrases without an explicit create command are accepted only
by a conservative deterministic rule: after an optional date or priority the
message must start with a supported action infinitive and include an object.
Questions, quotes, declarative sentences, discussion-like phrasing, and
noun-only messages remain ordinary conversation and never trigger a Core
write.

Dates are interpreted in `Asia/Vladivostok`. Exact times are stored as the
specified local time. Because the current Core contract has `dueAt` but no
date-only field, a date without a time means the explicit end of that local
calendar day (`23:59:59.999`). A weekday means the nearest strictly future
occurrence. Invalid, missing, or conflicting task details cause a clarification
response and no Core write.

Explicit priority phrases map to the existing Core values: `срочно` →
`critical`, `высокий приоритет` → `high`, `обычная` → `normal`, and
`низкий приоритет` → `low`. If no priority is present, Arthur omits the field
and Core applies its existing `normal` default.

If Core returns an error or times out, Arthur says that the task could not be
created and never sends a success confirmation.

## Limited write scope

Through Telegram you can only:
- create one internal Arthur task for the canonical owner without a separate approval;
- read the owner's active task list and task brief;
- read purchasing status;
- read owner review items;
- read final order summary;
- read knowledge search results.

You cannot:
- edit, complete, or delete tasks;
- change Owner Decisions;
- approve/reject items;
- send supplier orders;
- change matrices;
- change budgets.

The Gateway keeps the Telegram long-polling offset in process memory. It passes
`update_id` to Core as `sourceRef`, but Core currently has no uniqueness
constraint for that field. A crash after the task write and before the polling
offset advances can therefore create a duplicate when Telegram retries the
update. Persistent idempotency is outside this v1 change.

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
docker compose --env-file .env -f compose.yml up -d telegram-gateway
```

Always pass `--env-file .env` when running `docker compose` from outside the `docker/arthur` directory.

## Proxy support

If the server requires a proxy for outbound Telegram API requests, add to `.env`:

```bash
HTTP_PROXY=http://host.docker.internal:8443
HTTPS_PROXY=http://host.docker.internal:8443
NO_PROXY=localhost,127.0.0.1,postgres,api,arthur-api
```

The Gateway uses `undici.EnvHttpProxyAgent` only for Telegram API calls. Arthur internal services are excluded by `NO_PROXY`. Proxy credentials are never logged.

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

## Verify Telegram environment inside the container

Linux/macOS:

```bash
cd docker/arthur
docker compose exec telegram-gateway sh -c 'echo TELEGRAM_BOT_TOKEN_present=$([ -n "$TELEGRAM_BOT_TOKEN" ] && echo true || echo false)'
docker compose exec telegram-gateway sh -c 'echo TELEGRAM_ALLOWED_USER_IDS_present=$([ -n "$TELEGRAM_ALLOWED_USER_IDS" ] && echo true || echo false)'
```

Windows PowerShell:

```powershell
cd docker/arthur
docker compose exec telegram-gateway env | Select-String -Pattern 'TELEGRAM_BOT_TOKEN'
docker compose exec telegram-gateway env | Select-String -Pattern 'TELEGRAM_ALLOWED_USER_IDS'
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

Task creation changes only require rebuilding/restarting `telegram-gateway`;
the existing Core API already supports `POST /v1/tasks`.

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
