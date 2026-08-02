# MinMax direct mail intake

`apps/minmax-mail-intake` — автономный Node.js worker для критического контура
MinMax. n8n в этом контуре не используется.

Поток обработки:

```text
Yandex IMAP -> MIME/filter -> Purchasing API registry/upload
-> completed run -> source artifact verification -> owner SMTP notification
```

Worker получает письма через TLS IMAP и `BODY.PEEK[]`, поэтому не помечает их
прочитанными. После restart он снова видит подходящее письмо и использует
существующий backend registry. Отдельная база или checkpoint с бизнес-state не
создаются.

Idempotency key содержит mailbox, реальный IMAP UID, имя и размер вложения и
полный SHA-256. Уведомление повторно не отправляется, если registry уже содержит
`notification_sent_at`.

## Конфигурация

Обязательные переменные сервиса:

- `MINMAX_BUILD_SHA`;
- `MINMAX_ALLOWED_SENDER` и `MINMAX_SUBJECT_PATTERN` — пустые и accept-all
  значения запрещены;
- `MINMAX_IMAP_USER`, `MINMAX_IMAP_PASSWORD`;
- `MINMAX_SMTP_USER`, `MINMAX_SMTP_PASSWORD`, `MINMAX_SMTP_FROM`;
- `MINMAX_NOTIFY_EMAIL`;
- `MINMAX_PURCHASING_API_BASE_URL`, `PURCHASING_API_TOKEN`;
- `MINMAX_OWNER_UI_BASE_URL`.

Полный шаблон без секретов находится в
`docker/minmax-direct-mail-intake/.env.example`.

Health endpoint: `GET http://127.0.0.1:3220/health`. Ответ содержит build SHA,
статус IMAP, время poll, последний UID/run/event и безопасную последнюю ошибку.
`GET /events/latest` используется единым production-check для корреляции E2E.

## Production check

Единственная команда:

```bash
npm run arthur:minmax:direct:production-check
```

Дополнительно к service env runner требует
`MINMAX_E2E_MAIL_USER/MINMAX_E2E_MAIL_PASSWORD`. Если notification mailbox
отличается от intake mailbox, требуются
`MINMAX_NOTIFICATION_IMAP_USER/MINMAX_NOTIFICATION_IMAP_PASSWORD`.

Runner автоматически поднимает Purchasing backend и direct worker, временно
применяет уникальные E2E sender/subject filters, отправляет одно письмо,
проверяет run, source artifact, notification, Owner Review URL и replay после
restart, запускает полный `npm test`, а в `finally` восстанавливает production
sender/subject filters и проверяет их через health endpoint.

При ошибке runner печатает container state, health и последние 300 строк логов.
Пароли и API tokens не передаются через argv и не выводятся в diagnostics.
