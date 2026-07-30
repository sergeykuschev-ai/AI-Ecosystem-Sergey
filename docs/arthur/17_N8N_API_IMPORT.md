# Автоматический импорт workflow в n8n

## Назначение

Скрипт `scripts/arthur/import-n8n-workflows.js` загружает или обновляет два production workflow:

- `Arthur — Создать задачу (production)`;
- `Arthur — Утренняя сводка задач`.

После загрузки скрипт может сразу активировать их. Повторный запуск не создаёт дубликаты: workflow ищутся по точному имени и обновляются.

## Что нужно один раз создать в n8n

1. API key в `Settings → API`.
2. Header Auth credential `Arthur Core API Token`:
   - Header Name: `X-Arthur-Api-Token`;
   - Value: production-токен Arthur Core.
3. Telegram credential с токеном бота.
4. Узнать личный Telegram chat ID Сергея.

Секреты не записываются в Git и не вставляются в workflow JSON.

## Запуск

Скопировать пример окружения:

```bash
cp scripts/arthur/n8n-import.env.example .env.n8n-import
```

Заполнить значения локально, затем выполнить:

```bash
set -a
source .env.n8n-import
set +a
node scripts/arthur/import-n8n-workflows.js
```

PowerShell:

```powershell
$env:N8N_BASE_URL="https://адрес-n8n"
$env:N8N_API_KEY="секрет"
$env:N8N_ARTHUR_CREDENTIAL_ID="id-credential"
$env:N8N_TELEGRAM_CREDENTIAL_ID="id-credential"
$env:N8N_TELEGRAM_CHAT_ID="личный-chat-id"
node scripts/arthur/import-n8n-workflows.js
```

## Безопасная первая проверка

Для загрузки без активации:

```bash
N8N_ACTIVATE_WORKFLOWS=false node scripts/arthur/import-n8n-workflows.js
```

После проверки workflow в интерфейсе n8n можно повторить запуск с `N8N_ACTIVATE_WORKFLOWS=true`.

## Ограничение

Скрипт не создаёт credentials через API. Это сделано намеренно: токены вводятся один раз в защищённое хранилище n8n, а скрипт получает только их внутренние идентификаторы.
