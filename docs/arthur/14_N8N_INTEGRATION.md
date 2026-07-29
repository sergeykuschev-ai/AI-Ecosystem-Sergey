# Arthur Core + n8n

## Назначение

Первый рабочий сценарий n8n создаёт задачу в Arthur Core через защищённый внутренний API.

## Сетевая схема

- Arthur Core API: `http://arthur-api:8787`
- Общая сеть: `arthur_n8n`
- PostgreSQL остаётся только в сети `arthur_internal`
- Порты Arthur Core и PostgreSQL на хост не публикуются

## Подготовка

1. Создать `.env` для Arthur Core на основе `docker/arthur/.env.example`.
2. Запустить Arthur Core:

```bash
docker compose -f docker/arthur/compose.yml up -d --build
```

3. Подключить существующий контейнер n8n к общей сети:

```bash
sh scripts/arthur/connect-n8n-network.sh
```

4. При следующем контролируемом пересоздании контейнера n8n добавить переменную:

```text
ARTHUR_API_TOKEN=<тот же токен, что у Arthur Core>
```

Переменная обязательна для workflow. Секрет нельзя хранить внутри JSON workflow.

## Импорт workflow

Импортировать в n8n файл:

```text
n8n/workflows/arthur-create-task-webhook.json
```

После импорта проверить URL Arthur Core и активировать workflow.

## Входной webhook

```json
{
  "title": "Проверить новую выгрузку Min/Max",
  "domain": "business",
  "description": "Повторный прогон после обновления версии",
  "priority": "high",
  "dueAt": null
}
```

Обязательное поле только `title`. По умолчанию:

- `ownerId`: `sergey`
- `domain`: `personal`
- `priority`: `normal`
- `source`: `n8n`

## Проверка связи без изменения контейнера n8n

Токен можно временно передать только команде проверки:

```bash
docker exec \
  -e ARTHUR_API_TOKEN="$ARTHUR_API_TOKEN" \
  n8n node -e "fetch('http://arthur-api:8787/health').then(r=>r.text()).then(console.log)"
```

Для создания тестовой задачи используется защищённый маршрут `/v1/tasks` и заголовок `X-Arthur-Api-Token`.

## Ограничения текущего этапа

- workflow импортируется вручную;
- токен добавляется в окружение n8n только при контролируемом пересоздании контейнера;
- Telegram, Gmail и Calendar пока не подключены;
- Arthur Core не доступен из интернета.
