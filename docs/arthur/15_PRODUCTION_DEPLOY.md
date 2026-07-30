# Arthur Core: production deployment

## Цель

Поднять Arthur Core рядом с уже работающим контейнером `n8n`, не пересоздавая n8n и не затрагивая его volume, настройки или workflows.

Arthur Core и PostgreSQL не публикуют порты на хост. n8n обращается к API через общую Docker-сеть по адресу `http://arthur-api:8787`.

## 1. Подготовить секреты

Скопировать пример окружения:

```bash
cp docker/arthur/.env.example docker/arthur/.env
```

Заполнить два разных длинных случайных значения:

```text
ARTHUR_POSTGRES_PASSWORD=...
ARTHUR_API_TOKEN=...
ARTHUR_N8N_NETWORK=arthur_n8n
```

Файл `.env` не добавлять в Git.

## 2. Запустить безопасный deploy

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/arthur/deploy-production.ps1
```

macOS/Linux:

```bash
sh scripts/arthur/deploy-production.sh
```

Скрипт:

1. проверяет наличие Docker, `.env` и контейнера `n8n`;
2. поднимает PostgreSQL, миграции и Arthur Core;
3. подключает существующий контейнер `n8n` к сети `arthur_n8n`;
4. проверяет доступ к `/health` из отдельного контейнера в этой сети;
5. не пересоздаёт и не останавливает n8n.

## 3. Создать credential в n8n

В n8n создать credential типа **Header Auth**:

- Name: `Arthur Core API Token`
- Header Name: `X-Arthur-Api-Token`
- Header Value: значение `ARTHUR_API_TOKEN` из `docker/arthur/.env`

Токен хранится в защищённом credential n8n, а не в workflow JSON и не требует пересоздания контейнера n8n.

## 4. Проверить профиль владельца

До активации workflow выполнить защищённый запрос:

```text
GET /v1/profiles/sergey
```

Ожидается HTTP `200`. Если получен `404`, остановиться и отдельно согласовать значения профиля.
Создание `sergey` изменяет production storage и выполняется только контролируемым запросом
`POST /v1/profiles`; deploy-скрипт и importer профиль не создают.

## 5. Импортировать workflow автоматически

Подготовить локальное окружение по примеру `scripts/arthur/n8n-import.env.example`, затем выполнить:

```bash
set -a
source .env.n8n-import
set +a
ARTHUR_N8N_WORKFLOW=arthur-create-task-production node scripts/arthur/import-n8n-workflows.js
```

Скрипт создаёт или обновляет только `n8n/workflows/arthur-create-task-production.json`,
назначает credential по его внутреннему ID и всегда оставляет workflow выключенным.
Повторный запуск обновляет workflow с тем же именем и не создаёт дубликат.

## 6. Проверить и активировать

Отправить POST-запрос на production webhook n8n:

```json
{
  "title": "Проверить новую выгрузку Min/Max",
  "domain": "purchasing",
  "priority": "high",
  "description": "После получения совместимой версии сделать повторный прогон"
}
```

Ожидаемый ответ: HTTP 201 и объект созданной задачи.
До этого теста проверить настройки импортированного workflow и активировать его отдельным
контролируемым действием в n8n.

## Откат

Остановить Arthur Core без удаления базы:

```bash
docker compose --env-file docker/arthur/.env -f docker/arthur/compose.yml down
```

Отключить n8n от сети:

```bash
docker network disconnect arthur_n8n n8n
```

Данные n8n при этом не затрагиваются.
