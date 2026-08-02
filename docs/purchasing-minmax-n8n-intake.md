# Приём отчёта Min/Max из Яндекс Почты через n8n

## Назначение

Автоматический конвейер: отчёт Min/Max (Excel) приходит письмом на
Яндекс Почту → n8n забирает письмо по IMAP → проверяет отправителя,
тему и вложение → загружает Excel в Purchasing Web API → дожидается
завершения run → отправляет владельцу письмо со ссылкой на Owner Review.

**Заказ поставщику автоматически не отправляется.** Все решения —
только через Owner Review владельца.

## Топологии

### Local development (Mac)

```
Яндекс Почта (imap.yandex.ru:993)
        ↑ IMAP, пароль приложения
   n8n (Docker-контейнер на Mac)
        ↓ HTTP
   http://host.docker.internal:3210  →  Purchasing Web API на Mac
        (npm run purchasing:web, host 127.0.0.1)
        ↑
   Браузер владельца: http://localhost:3210/?runId=<uuid>
```

- `MINMAX_API_BASE_URL=http://host.docker.internal:3210`
- Backend слушает только loopback; токен не обязателен (но рекомендуется
  задать `PURCHASING_API_TOKEN` сразу, чтобы конфигурация совпадала с
  production).

### Production (Windows Server + Docker Desktop)

```
Яндекс Почта (imap.yandex.ru:993)
        ↑ IMAP
   n8n (Docker-контейнер на Windows Server)
        ↓ HTTP
   http://host.docker.internal:3210  →  Purchasing Web API на том же
        сервере (PURCHASING_WEB_HOST=127.0.0.1 или явный адрес,
        PURCHASING_API_TOKEN обязателен)
        ↑
   Браузер владельца на сервере: http://localhost:3210/?runId=<uuid>
```

- Основной workflow получает URL Purchasing API через env
  `MINMAX_API_BASE_URL` в контейнере n8n.
- Для production-установок n8n, где доступ к `$env` запрещён, используйте
  отдельный workflow
  `n8n/workflows/arthur-minmax-yandex-mail-intake-fixed.json`. Его параметры
  собраны в ноде `Конфигурация MinMax`; основной env-вариант при этом не
  изменяется.
- `host.docker.internal` на Windows с Docker Desktop работает
  нативно; при запуске backend в отдельном контейнере используйте имя
  сервиса (например `http://purchasing-api:3210`) в общей docker-сети.
- Backend не открывается в локальную сеть без защиты: если
  `PURCHASING_WEB_HOST` отличается от `127.0.0.1`, обязателен
  `PURCHASING_API_TOKEN` (см. раздел «Защита API»).

## Подготовка Яндекс Почты

1. Включить двухфакторную аутентификацию в аккаунте Яндекса.
2. Создать **пароль приложения** для почты (Почта → «Пароли
   приложений»). Обычный пароль аккаунта не подходит.
3. В настройках Яндекс Почты разрешить доступ по IMAP.
4. IMAP: `imap.yandex.ru:993`, SSL.
5. SMTP: `smtp.yandex.ru:465` (SSL) или `:587` (STARTTLS) — отдельный
   credential в n8n.

Пароль приложения хранится **только в n8n Credentials**. Секреты не
должны попадать в git, workflow JSON, документацию и логи.

## n8n Credentials (создать вручную в UI)

| Credential | Тип | Содержимое |
|---|---|---|
| `MinMax Yandex IMAP` | IMAP | host `imap.yandex.ru`, port `993`, SSL on, user = полный e-mail, password = пароль приложения |
| `MinMax Yandex SMTP` | SMTP | host `smtp.yandex.ru`, port `465`, SSL on, user = полный e-mail, password = пароль приложения |
| `Purchasing API Token` | Header Auth | credential для основного env-варианта; header name `x-api-key`, value = `PURCHASING_API_TOKEN` |
| `Arthur Core API` | Header Auth | credential с тем же API-заголовком для Fixed Config-варианта в текущей production-установке |

## Fixed Config-вариант без доступа к env

Workflow `Arthur — MinMax Yandex Mail Intake (Fixed Config)` полностью
исключает обращения к `$env` и `process.env` внутри нод. Он использует:

- IMAP mailbox: фиксированный `INBOX`;
- IMAP format: `Resolved`;
- Purchasing upload: `http://host.docker.internal:3210/api/v1/runs`;
- Header Auth credential: `Arthur Core API`;
- SMTP/IMAP credentials: существующие `MinMax Yandex SMTP` и
  `MinMax Yandex IMAP`.

Все несекретные параметры находятся в Code-ноде `Конфигурация MinMax`.
Production deploy автоматически подставляет доступный владельцу
`MINMAX_OWNER_UI_BASE_URL`, адрес уведомления и SMTP From; открывать и
редактировать ноду вручную не нужно.
Пустые `allowedSender` и `subjectPattern` отключают соответствующие фильтры;
после определения стабильного отправителя и темы их рекомендуется заполнить.
Пароли и API-токен в конфигурационную ноду не добавляются: они остаются в
n8n Credentials.

Fixed Config разворачивается через Public API n8n как отдельный workflow.
Production deploy публикует конкретную сохранённую версию и затем сверяет её
с JSON репозитория; ручной CLI import для этого workflow не используется.

### Обязательная версия Purchasing backend

Fixed Config workflow и backend этой ветки используют один HTTP-контракт:

| Операция workflow | Метод и endpoint |
|---|---|
| Проверить реестр | `GET /api/v1/upload-idempotency/:key` |
| Записать ignored/rejected | `POST /api/v1/upload-idempotency` |
| Загрузить Excel | `POST /api/v1/runs` |
| Проверить run | `GET /api/v1/runs/:runId` |
| Получить сводку | `GET /api/v1/runs/:runId/summary` |
| Получить счётчики | `GET /api/v1/runs/:runId/items?page_size=1` |
| Отметить уведомление | `POST /api/v1/upload-idempotency/:key/notification` |
| Отметить uncertain | `POST /api/v1/upload-idempotency/:key/state` |

Маршруты `upload-idempotency` добавлены в backend в коммите `f7063e9`.
Ответ `ROUTE_NOT_FOUND` от любого из них означает, что Windows-сервер запущен
из более старой версии репозитория. В этом случае переимпорт одного workflow
не поможет: необходимо обновить и перезапустить Purchasing backend.

API-аутентификация backend использует заголовок `x-api-key`. Credential
`Arthur Core API` должен иметь тип Header Auth с именем заголовка
`x-api-key`; `Authorization: Bearer` этим backend не поддерживается.

Каждая HTTP-нода Fixed workflow явно отправляет
`Accept: application/json` и сохраняет `Response Format = JSON`. Менять
Response Format на Text не требуется и нельзя: актуальный backend возвращает
JSON и для успешных ответов, и для ошибок 401/404.
После обновления репозитория Fixed workflow нужно развернуть командой
`npm run arthur:minmax:deploy`. Она обновляет draft, публикует его точный
`versionId` и проверяет active version без ручного редактирования нод.

Для однозначного обнаружения старого процесса backend предоставляет защищённый
`GET /api/v1/health`. Ответ содержит `service=purchasing-web`, версию
MinMax HTTP-контракта и `build_sha`, переданный при запуске процесса.

## Переменные окружения

### Purchasing backend

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `PURCHASING_WEB_PORT` | `3210` | Порт API |
| `PURCHASING_WEB_HOST` | `127.0.0.1` | Адрес прослушивания; менять только осознанно |
| `PURCHASING_API_TOKEN` | (пусто = защита выключена) | Токен для не-loopback запросов, 16–512 символов |

### Контейнер n8n — основной env-вариант

| Переменная | Пример | Назначение |
|---|---|---|
| `MINMAX_API_BASE_URL` | `http://host.docker.internal:3210` | Base URL Purchasing API |
| `MINMAX_ALLOWED_SENDER` | `minmax@supplier.ru` | Разрешённый отправитель (подстрока From, без учёта регистра) |
| `MINMAX_SUBJECT_PATTERN` | `min/max отчёт` | Шаблон темы (подстрока, без учёта регистра) |
| `MINMAX_IMAP_MAILBOX` | `INBOX` | Папка IMAP |
| `MINMAX_NOTIFY_EMAIL` | `owner@example.ru` | Адрес уведомления владельца |
| `MINMAX_SMTP_FROM` | (по умолчанию = `MINMAX_NOTIFY_EMAIL`) | Адрес From для писем; должен совпадать с SMTP-логином |
| `MINMAX_MAX_ATTACHMENT_BYTES` | `20971520` | Максимальный размер вложения |
| `MINMAX_POLL_INTERVAL_SECONDS` | `30` | Интервал опроса статуса run (макс. 300) |
| `MINMAX_POLL_TIMEOUT_SECONDS` | `900` | Максимальное время ожидания run |
| `MINMAX_OWNER_UI_BASE_URL` | `http://localhost:3210` | База ссылки Owner Review в письме |

Токен API **не задаётся env в n8n** — он живёт в credential
`Purchasing API Token`.

## Импорт workflow

```bash
export ARTHUR_N8N_WORKFLOW=arthur-minmax-yandex-mail-intake
export N8N_BASE_URL=https://n8n.example.ru
export N8N_API_KEY=<api-key n8n>
export N8N_PURCHASING_CREDENTIAL_ID=<id credential «Purchasing API Token»>
export N8N_MINMAX_IMAP_CREDENTIAL_ID=<id credential «MinMax Yandex IMAP»>
export N8N_MINMAX_SMTP_CREDENTIAL_ID=<id credential «MinMax Yandex SMTP»>
node scripts/arthur/import-n8n-workflows.js
```

Для Fixed Config-варианта CLI import не применяется: n8n import сохраняет
workflow и деактивирует его, но в n8n 2.x сохранённая draft-версия и
published active version — разные сущности. Production execution использует
published version. Используйте автоматический deploy через Public API.

### Автоматический deploy Fixed Config на Windows

API key n8n должен иметь scopes для чтения, создания/обновления,
публикации/деактивации и архивации workflows. IDs credentials берутся из env;
значения credentials и секреты через API не читаются и в JSON не записываются.

Низкоуровневая команда обновления и публикации:

```powershell
$env:N8N_BASE_URL='https://<N8N-HOST>'; $env:N8N_API_KEY='<N8N-API-KEY>'; $env:N8N_MINMAX_WORKFLOW_ID='minmaxYandexIntakeFixed01'; $env:N8N_ARTHUR_CREDENTIAL_ID='<ARTHUR-CORE-API-CREDENTIAL-ID>'; $env:N8N_MINMAX_IMAP_CREDENTIAL_ID='<IMAP-CREDENTIAL-ID>'; $env:N8N_MINMAX_SMTP_CREDENTIAL_ID='<SMTP-CREDENTIAL-ID>'; npm run arthur:minmax:deploy
```

Повторная независимая проверка при уже заданных env:

```powershell
npm run arthur:minmax:verify
```

Deploy находит record сначала по стабильному ID, затем по точному имени и не
создаёт новый record, если существующий найден. После PUT/POST он вызывает
`POST /api/v1/workflows/:id/activate` с сохранённым `versionId`.
Одноимённые старые records деактивируются и архивируются, чтобы IMAP trigger
не мог продолжить выполнение старой версии.

Перед Public API PUT deploy нормализует каждую ноду по writable allowlist
схемы n8n 2.28.6. Legacy top-level retry-поля `maxRetries` и
`waitBetweenRetries` преобразуются в разрешённые `maxTries` и
`waitBetweenTries`; `parameters`, credentials, `typeVersion` и `position`
сохраняются без изменений. Это отличие от CLI importer, который принимает
более широкий внутренний JSON, чем строгая Public API OpenAPI-схема.

Переменная credential для Arthur Core называется строго
`N8N_ARTHUR_CREDENTIAL_ID`. Если по ошибке задана
`N88N_ARTHUR_CREDENTIAL_ID`, deploy завершается до HTTP-запроса и прямо
указывает на опечатку.

Verify получает фактический workflow через API и проверяет:

- `id`, `name`, `active`, `versionId`, active version и `updatedAt`;
- семантическое совпадение draft и published version с repo JSON после того,
  как ко всем трём представлениям применена одна canonicalization;
- все восемь HTTP-нод, их URL, `Accept: application/json`, JSON response
  format и credential `Arthur Core API` с ID из env;
- `INBOX`, resolved IMAP format, IMAP/SMTP credential IDs и отсутствие
  `$env`/`process.env` во всех нодах;
- отсутствие второго неархивированного workflow с тем же именем.

Canonicalization игнорирует только порядок JSON-ключей и нод, read-only
metadata, пустые значения и документированные defaults n8n. Credential type
и ID, параметры, URL, method, headers, response format, node type/typeVersion,
connections, retry-настройки и явно отличающиеся settings продолжают
сравниваться. При реальном расхождении verify печатает путь в формате
`node name → path → expected → actual`. Если raw JSON отличается только из-за
нормализации n8n, команда показывает эти raw-различия как `INFO`, но успешно
завершается по совпавшим semantic hashes.

n8n 2.28.6 при сохранении через API добавляет `webhookId` нодам, чей node
type объявляет webhook definitions. В частности, Email Send 2.1 содержит
webhook для операции Send-and-Wait, поэтому UUID появляется и у сохранённых
нод обычной отправки письма. При сравнении такой `webhookId` считается
generated metadata только если соответствующая repo-нода не задаёт его.
Явно зафиксированный `webhookId` (например, у Wait-ноды) остаётся частью
строгого semantic contract. Canonicalizer не изменяет deploy payload или
сохранённый ответ n8n; исключение действует только внутри verifier.

Успешный deploy заканчивается собственным verify и не требует кликов в UI.
Если заданы `MINMAX_OWNER_UI_BASE_URL`, `MINMAX_NOTIFY_EMAIL` и
`MINMAX_SMTP_FROM`, deploy подставляет их в Fixed Config до сохранения и
проверяет именно это production-представление в draft и active version.

### Автоматическая проверка упавшего execution

Inspector получает execution через Public API с `includeData=true`, извлекает
фактически выполненный workflow, `runData`, вход ноды `Проверить реестр`,
`idempotencyKey`, URL и credential reference. Затем он получает безопасную
metadata credential (`id`, `name`, `type`) и повторяет тот же registry GET из
контейнера n8n с `Accept: application/json` и `x-api-key`. Секрет передаётся в
контейнер только через process environment и не печатается.

```powershell
npm run arthur:minmax:inspect -- --execution-id 272
```

Нужны уже описанные `N8N_BASE_URL`, `N8N_API_KEY`,
`N8N_ARTHUR_CREDENTIAL_ID`, а также `PURCHASING_API_TOKEN` и
`N8N_CONTAINER_NAME`. Public API n8n намеренно не возвращает credential data,
поэтому имя header подтверждается эффективно: Purchasing backend принимает
только `x-api-key`, а container replay должен вернуть JSON 200 или JSON 404.

HTTP Request node n8n 2.28.6 при неудачном `JSON.parse()` создаёт новый
`NodeOperationError` и обычно не сохраняет исходные status, headers и body в
execution. Inspector показывает их, если `cause` сохранился; иначе явно пишет
`not retained` и получает точный текущий raw response повтором того же URL.

Одна команда deploy + semantic verify + inspection + container replay:

```powershell
npm run arthur:minmax:deploy:check -- --execution-id 272
```

## Постоянный backend и единая production-проверка

Production backend описан в
`docker/purchasing-web-backend/compose.yml`. Контейнер публикует порт `3210`,
имеет healthcheck и `restart: unless-stopped`. Каталоги `output/` и
`data/purchasing/` подключены с Windows-хоста, поэтому runs, source artifacts,
реестр идемпотентности и решения владельца переживают rebuild/restart.
Закрытие PowerShell не останавливает backend.

Перед первым запуском задаются секреты и адреса уведомления:

```powershell
$env:N8N_API_KEY='<N8N-API-KEY>'
$env:PURCHASING_API_TOKEN='<VALUE-OF-ARTHUR-CORE-API-CREDENTIAL>'
$env:MINMAX_E2E_MAIL_USER='<YANDEX-MAIL-LOGIN>'
$env:MINMAX_E2E_MAIL_PASSWORD='<YANDEX-APP-PASSWORD>'
$env:MINMAX_NOTIFY_EMAIL='<OWNER-EMAIL>'
$env:MINMAX_SMTP_FROM='<SMTP-FROM>'
```

Если `MINMAX_NOTIFY_EMAIL` отличается от `MINMAX_E2E_MAIL_USER`, до запуска
также обязательны `MINMAX_NOTIFICATION_IMAP_USER` и
`MINMAX_NOTIFICATION_IMAP_PASSWORD` для проверки полученного уведомления.

Затем используется одна команда:

```powershell
npm run arthur:minmax:production-check
```

По умолчанию используются production IDs из текущего контура, локальный n8n
`http://127.0.0.1:5678`, контейнер `n8n`, Yandex SMTP `465` и IMAP `993`.
`MINMAX_OWNER_UI_BASE_URL` необязателен: runner использует Windows hostname и
порт `3210`; его можно задать явно, если владелец открывает UI по другому
LAN/DNS адресу. Runner всегда деплоит непустые production-фильтры:
`MINMAX_ALLOWED_SENDER` равен `MINMAX_E2E_MAIL_USER`, а
`MINMAX_SUBJECT_PATTERN` по умолчанию равен `minmax production e2e`.
Historical inspect выполняется только при явном `MINMAX_EXECUTION_ID`.
Значения credentials API не читаются и не печатаются.
До временного E2E deploy runner сохраняет все runtime-поля опубликованного
`activeVersion`. В `finally` он повторно deploy/publish исходной production-
конфигурации и проверяет новый `activeVersion` и точное совпадение полей.
Пустая или accept-all исходная конфигурация блокирует E2E до deploy, а ошибка
restore всегда превращает общий результат в `FAIL`.

Команда автоматически:

- проверяет ветку и SHA, строит/запускает Docker service и реально перезапускает
  контейнер для проверки restart;
- Docker healthcheck выполняется встроенным Node.js и требует HTTP 200, JSON,
  `service=purchasing-web` и `build_sha`, равный текущему HEAD;
- проверяет health с Windows и из контейнера n8n, JSON 404/200/401 и настоящий
  `connection refused`;
- при явном `MINMAX_EXECUTION_ID` инспектирует указанный execution с фактическим
  runData и точным container replay;
- deploy/publish/verify workflow, activeVersion, metadata трёх credentials и
  отсутствие активного дубля;
- отправляет через Yandex SMTP уникальное письмо с одним synthetic Excel,
  ждёт IMAP trigger и единственный execution, completed run и отметку
  notification;
- проверяет исходный Excel artifact, получение уведомления через IMAP,
  открытие Owner Review deep link и multipart replay без второго run;
- независимо от результата E2E восстанавливает и публикует исходную production-
  конфигурацию, затем проверяет её `activeVersion`;
- запускает полный `npm test` и печатает один итоговый `[RESULT] PASS` либо
  `[RESULT] FAIL <точная причина>`.

Если любой этап не подтверждён, команда завершается `FAIL`; частично зелёные
локальные проверки не считаются end-to-end успехом.
При Docker health failure runner сам печатает полный `.State.Health`, все
`Health.Log`, `State.Status/ExitCode/Error/OOMKilled`, `RestartCount`, последние
300 строк container/compose logs, image command/entrypoint, redacted env,
mounts, published ports, наличие Node.js и ответы health endpoint из контейнера
и с Windows host. Ручные `docker inspect`, `docker logs` и `curl` не требуются.
Образ копирует все runtime roots (`apps/`, `agents/`, `shared/`) и перед E2E
runner проверяет их наличие, production dependencies, write-доступ к
`/app/output` и `/app/data/purchasing`, стабильный `RestartCount`, healthy state
и фактическую публикацию `3210/tcp` на host port `3210`.
Все Node.js probes, запускаемые через `docker exec`, передают программу по stdin
командой `docker exec -i <container> node -`; inline `node -e` и JavaScript в
Windows argv не используются. Значения API token передаются только через env.

## Защита API

- Loopback-запросы (браузер владельца на том же сервере) работают без
  токена всегда.
- Не-loopback запросы к `/api/` требуют заголовок `x-api-key`, если
  задан `PURCHASING_API_TOKEN`; иначе — `401 API_TOKEN_REQUIRED`,
  неверный токен — `401 API_TOKEN_INVALID`.
- Токен не попадает в ответы, заголовки ответов и логи.
- Статический UI (не `/api/`) доступен без токена.

## Идемпотентность: какой механизм фактически выбран

**Источник истины — файловый реестр Purchasing backend**
(`output/purchasing-web/upload-idempotency.json`, путь можно переопределить
в коде сервера), а не workflow static data и не память n8n.

Причины выбора:
- переживает переимпорт workflow, переустановку и рестарт n8n;
- инспектируем через API и как обычный JSON-файл;
- кроссплатформенная атомарная запись: temp-файл в каталоге registry,
  обязательный fsync temp и rename/replace; на Windows transient
  `EPERM`/`EEXIST`/`EACCES`/`EBUSY` от rename повторяются без удаления
  существующего registry;
- fsync каталога выполняется только на поддерживаемых платформах и является
  best-effort после commit point: его ошибка не превращает уже сохранённую
  запись в ложный `507`; сериализация записей выполняется через
  внутрипроцессную очередь;
- не зависит от недоступных/непроверяемых в данной среде n8n Data
  Store/Data Table.

Запись реестра содержит: `idempotencyKey`, `mailbox`, `messageUid`,
`attachmentName`, `attachmentSize`, `sha256`, `state`
(`received`/`uploading`/`run_created`/`processing`/`completed`/`failed`/
`uncertain`/`ignored`/`rejected`), `runId`, `errorCode`, `createdAt`,
`updatedAt`, `notificationSentAt`.

Ключ строится workflow как
`minmax-<mailbox>-<UID>-<имя файла>-<размер>-<sha256-16>`
(санитизация до URL-безопасного алфавита), где:

- `<UID>` — реальный UID письма из `$json.attributes.uid` (Email Trigger
  (IMAP) v2, формат resolved); фолбэки: `$json.uid`, затем
  `$json.messageId` (RFC-заголовок);
- `<sha256-16>` — первые 16 hex-символов sha256 содержимого вложения,
  вычисленного в Code-ноде чистой JS-реализацией (без `require('crypto')`,
  чтобы не зависеть от `NODE_FUNCTION_ALLOW_BUILTIN`); если данные
  вложения недоступны (binary-режим filesystem), компонент равен `na`,
  и уникальность опирается на UID + имя + размер.

**ВАЖНО про UIDVALIDITY.** IMAP-нода n8n **не возвращает UIDVALIDITY**
(проверено по исходному коду n8n: `EmailReadImapV2.node.ts` и
`v2/utils.ts` — в emitted item попадает только `attributes.uid`).
Поэтому выдуманная или постоянная константа в ключе не используется;
вместо UIDVALIDITY ключ усилен sha256 содержимого вложения. Это закрывает
сценарий смены UIDVALIDITY (пересоздание ящика → переиспользование UID):
у другого письма другой sha256, значит и другой ключ — коллизия невозможна.
Дополнительно backend независимо проверяет ключ вместе с sha256 файла:
совпадение ключа при другом содержимом даёт `409 IDEMPOTENCY_KEY_CONFLICT`.

Seen-флаг, память execution,
метка времени и одно лишь имя файла ключом не являются.

## Как backend предотвращает второй run

`POST /api/v1/runs` принимает `x-idempotency-key` (header) или
multipart-поле `idempotency_key`:

1. Файл всегда принимается и хэшируется (sha256).
2. Ключа нет в реестре → создаётся запись и run, состояние
   последовательно `received → uploading → run_created → processing →
   completed` (или `failed` с `errorCode`).
3. Ключ есть и sha256 совпадает → **существующий run возвращается**
   (`200`, `idempotent_replay: true`, тот же `run_id`), новый run не
   создаётся — даже если обрыв произошёл после создания run.
4. Ключ есть, но sha256 другой → `409 IDEMPOTENCY_KEY_CONFLICT`, run
   не создаётся.
5. Повтор только по совпадению имени файла невозможен: совпадение
   проверяется по ключу + sha256.

Дополнительные endpoint'ы реестра:

- `GET /api/v1/upload-idempotency/:key` — инспекция записи.
- `POST /api/v1/upload-idempotency` — запись `ignored`/`rejected` для
  отфильтрованных писем (без run).
- `POST /api/v1/upload-idempotency/:key/notification` — фиксация
  `notificationSentAt` после письма владельцу.
- `POST /api/v1/upload-idempotency/:key/state` — перевод в `uncertain`
  (completed/failed терминальны и не перезаписываются).

## Восстановление workflow после обрыва

| Точка обрыва | Повторный запуск делает |
|---|---|
| До загрузки | Реестр пуст → обычная загрузка |
| Во время/после загрузки, ответ не получен | Backend-idempotency: повтор с тем же ключом возвращает существующий run (`idempotent_replay`) |
| Run создан, статус неизвестен | Реестр: `run_created`/`processing` + `runId` → workflow переходит к polling, не загружая файл |
| Run завершён, письмо не отправлено | Реестр: `completed`, `notificationSentAt` пуст → действие `notify`: только письмо, без нового run |
| Письмо отправлено | `notificationSentAt` заполнен → действие `done` |
| Таймаут polling / неопределённость | Письмо об ошибке владельцу + состояние `uncertain` |

Состояние `uploading` до HTTP-запроса само по себе не считается
достаточным: повтор всегда идёт через backend, который решает по
ключу + sha256.

## Исходный Excel как artifact run

Backend сохраняет загруженный файл как бинарный artifact
`source-report.xlsx`/`source-report.xls`:

- доступен только через защищённый API (`GET /api/v1/runs/:id/artifacts/...`);
- manifest содержит очищенное исходное имя, `received_at`, sha256 и
  размер;
- retention удаляет файл вместе с run;
- исходник другого run скачать нельзя (manifest привязан к run);
- бинарное содержимое не попадает в логи.

## Фильтрация писем

Письмо обрабатывается только при одновременном совпадении:

1. отправитель содержит `MINMAX_ALLOWED_SENDER`;
2. тема содержит `MINMAX_SUBJECT_PATTERN`;
3. ровно одно вложение `.xlsx`/`.xls`;
4. размер ≤ `MINMAX_MAX_ATTACHMENT_BYTES`;
5. сигнатура файла соответствует Excel (PK ZIP / OLE2).

Исходы: `ignored` (не наше письмо), `rejected` (письмо Min/Max, но
вложение не подходит — письмо об ошибке владельцу), `process`.
Неподходящее письмо никогда не помечается успешно обработанным.

IMAP-нода настроена в формате `resolved` (`"format": "resolved"` в
параметрах): только в нём вложения гарантированно попадают в binary, а
UID письма — в `$json.attributes.uid`. Формат `simple` без включённого
`downloadAttachments` вложения не скачивает, и фильтр игнорировал бы
все письма — менять формат нельзя.

Папки `AI-Закупщик/Обработано` и `AI-Закупщик/Ошибка` — опциональное
удобство. Workflow намеренно использует `postProcessAction: nothing`:
перемещение не является источником истины, его сбой не может создать
повторный run. При желании папки можно включить в IMAP-ноде вручную.

## Проверка доступа n8n к backend в production

Из контейнера n8n:

```bash
docker exec -it <n8n-container> sh -c \
  "wget -qO- --header='x-api-key: <PURCHASING_API_TOKEN>' \
   http://host.docker.internal:3210/api/v1/upload-idempotency/minmax-healthcheck-00000000"
```

- `404 UPLOAD_IDEMPOTENCY_RECORD_NOT_FOUND` — связность и токен в
  порядке (endpoint существует, запись отсутствует).
- `401` — токен не совпадает или не передан.
- Таймаут/ошибка соединения — backend недоступен из контейнера
  (проверить `PURCHASING_WEB_HOST`, `host.docker.internal`, firewall).

## Матрица ошибок

| Сценарий | Поведение |
|---|---|
| Письмо не от разрешённого отправителя | `ignored`, запись в реестре, писем нет |
| Неверная тема | `ignored` |
| Нет вложений | `ignored` |
| Вложение не Excel | `rejected` + письмо об ошибке |
| Несколько Excel-вложений | `rejected` + письмо об ошибке |
| Вложение слишком большое | `rejected` + письмо об ошибке |
| Поддельная сигнатура | `rejected` + письмо об ошибке |
| API недоступен при загрузке | retry ×3 с паузой 30 с (backend идемпотентен), затем `uncertain` + письмо об ошибке |
| 409 RUN_ALREADY_IN_PROGRESS | Повторный запрос к реестру → `poll`/`replay` существующего run |
| 409 IDEMPOTENCY_KEY_CONFLICT | Письмо об ошибке, новый run не создаётся |
| Run завершился с `failed` | Письмо об ошибке с кодом, повторный run не создаётся |
| Polling превысил таймаут | `uncertain` + письмо об ошибке |
| SMTP недоступен | Исполнение падает с ошибкой; при следующем письме/запуске `notificationSentAt` пуст → повтор только письма |
| Backend вернул 401 | Проверить credential `Purchasing API Token` |

## Ручная проверка (ЭТАП 15)

1. Запустить backend: `npm run purchasing:web` (с
   `PURCHASING_API_TOKEN` для production-профиля).
2. Импортировать workflow, назначить credentials, заполнить env.
3. Отправить письмо с разрешённого адреса, темой по шаблону и одним
   `.xlsx` → владелец получает уведомление со ссылкой
   `?runId=<uuid>`.
4. Открыть ссылку → Owner Review показывает run без повторной
   загрузки Excel.
5. Повторить то же письмо → новый run не создаётся, владельцу письмо
   не дублируется (`done`).
6. Письмо с чужого адреса → `ignored`, реестр содержит запись.
7. Письмо с PDF → `rejected` + письмо об ошибке.
8. Письмо с двумя Excel → `rejected`.
9. Письмо > лимита → `rejected`.
10. Остановить backend до загрузки → retry ×3 → `uncertain` + письмо
    об ошибке; после запуска backend повторное письмо обрабатывается
    без дубликата run.
11. Проверить `GET /api/v1/upload-idempotency/<key>` — состояние
    `completed`, `notificationSentAt` заполнен.
12. Проверить artifacts run: `source-report.xlsx` скачивается и
    совпадает с вложением.
13. Проверить, что заказ поставщику не отправлялся.
14. Проверить, что секреты не видны в workflow JSON, execution-логах
    n8n и логах backend.
15. Проверить 401 для внешнего запроса без токена (production-профиль).
16. Проверить, что loopback-браузер работает без токена.
