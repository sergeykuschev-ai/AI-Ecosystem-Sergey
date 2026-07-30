# Arthur — утренняя сводка задач

## Назначение

Каждое утро Arthur получает из Arthur Core задачи Сергея и отправляет в Telegram короткую сводку:

- просроченные задачи;
- задачи на ближайшие 24 часа;
- задачи, по которым ожидается ответ или событие;
- сообщение об отсутствии срочных задач, если список пуст.

## Workflow

Файл для импорта:

`n8n/workflows/arthur-morning-task-brief-production.json`

Workflow по умолчанию запускается ежедневно в **08:00** в часовом поясе `Europe/Paris`.

## Подготовка в n8n

### 1. Arthur Core API Token

Использовать уже созданный credential типа **Header Auth**:

- Name: `Arthur Core API Token`
- Header name: `X-Arthur-Api-Token`
- Value: production-токен Arthur Core

После импорта выбрать этот credential в узле `Arthur Core — получить сводку`.

### 2. Telegram Bot

Создать credential типа **Telegram API** с токеном отдельного бота Arthur.

После импорта выбрать credential в узле `Telegram — отправить сводку`.

### 3. Chat ID

В узле `Telegram — отправить сводку` заменить `REPLACE_CHAT_ID` на Telegram chat ID Сергея.

Chat ID не является токеном бота, но его не храним в репозитории.

## Первый запуск

1. Импортировать workflow.
2. Назначить оба credential.
3. Указать chat ID.
4. Нажать **Execute workflow** и проверить сообщение в Telegram.
5. Только после успешной ручной проверки активировать workflow.

## Формат сообщения

Сообщение ограничивает каждый раздел десятью строками, чтобы утренняя сводка оставалась короткой. HTML-символы в названиях задач экранируются.

## Безопасность

- Arthur Core доступен только по внутреннему адресу `http://arthur-api:8787`.
- API-токен и Telegram bot token не находятся в JSON.
- Workflow после импорта не активируется автоматически.
- PostgreSQL и Arthur Core не публикуют порты на хост.

## Изменение времени

В узле `Каждое утро в 08:00` изменить cron-выражение. Текущее значение:

```text
0 8 * * *
```

Часовой пояс задаётся в настройках workflow: `Europe/Paris`.
