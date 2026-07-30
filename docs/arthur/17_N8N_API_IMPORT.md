# Автоматический импорт workflow в n8n

## Назначение

Скрипт `scripts/arthur/import-n8n-workflows.js` загружает или обновляет один явно выбранный production workflow.
Выбор задаётся переменной `ARTHUR_N8N_WORKFLOW`.

Поддерживаются:

- `arthur-create-task-production` — `Arthur — Создать задачу (production)`;
- `arthur-morning-task-brief-production` — `Arthur — Утренняя сводка задач`.

Неизвестное или пустое значение завершает скрипт с понятной ошибкой до обращения к n8n.
После загрузки workflow всегда деактивируется. Повторный запуск не создаёт дубликат:
workflow ищется по точному имени и обновляется.

## Что нужно один раз создать в n8n

1. API key в `Settings → API`.
2. Header Auth credential `Arthur Core API Token`:
   - Header Name: `X-Arthur-Api-Token`;
   - Value: production-токен Arthur Core.

Секреты не записываются в Git и не вставляются в workflow JSON.

Для `arthur-create-task-production` Telegram credential и Telegram chat ID не нужны.
Они обязательны только для `arthur-morning-task-brief-production`.

## Проверить профиль владельца

До создания первой задачи защищённый запрос `GET /v1/profiles/sergey` должен вернуть профиль.
Если Arthur Core возвращает `404`, импорт workflow можно выполнить, но активировать и вызывать его нельзя:
сначала нужно отдельно согласовать данные профиля и создать `sergey` через `POST /v1/profiles`.
Скрипт импорта не создаёт и не изменяет профиль.

## Безопасный импорт create-task

Скопировать пример окружения:

```bash
cp scripts/arthur/n8n-import.env.example .env.n8n-import
```

Заполнить значения локально, затем выполнить:

```bash
set -a
source .env.n8n-import
set +a
ARTHUR_N8N_WORKFLOW=arthur-create-task-production node scripts/arthur/import-n8n-workflows.js
```

Скрипт создаст или обновит только `Arthur — Создать задачу (production)` и оставит его выключенным.
После проверки настроек и профиля `sergey` workflow активируется отдельным контролируемым действием.

PowerShell:

```powershell
$env:N8N_BASE_URL="https://адрес-n8n"
$env:N8N_API_KEY="секрет"
$env:N8N_ARTHUR_CREDENTIAL_ID="id-credential"
$env:ARTHUR_N8N_WORKFLOW="arthur-create-task-production"
node scripts/arthur/import-n8n-workflows.js
```

## Импорт morning brief

Для утренней сводки выбрать другой workflow и дополнительно передать идентификаторы Telegram:

```bash
ARTHUR_N8N_WORKFLOW=arthur-morning-task-brief-production \
N8N_TELEGRAM_CREDENTIAL_ID=replace-with-credential-id \
N8N_TELEGRAM_CHAT_ID=replace-with-chat-id \
node scripts/arthur/import-n8n-workflows.js
```

Отсутствие любого Telegram-параметра для morning brief завершает импорт ошибкой до обращения к n8n.

## Ограничение

Скрипт не создаёт credentials через API. Это сделано намеренно: токены вводятся один раз в защищённое хранилище n8n, а скрипт получает только их внутренние идентификаторы.
