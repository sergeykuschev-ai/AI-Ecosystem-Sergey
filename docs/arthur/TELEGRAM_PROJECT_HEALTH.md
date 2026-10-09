# Arthur Telegram — read-only project status (09.10.2026)

## Команда

В авторизованном Telegram-чате Артура: `/projects` или `Статус проектов`.
После проверки Telegram user ID gateway читает последний валидный отчёт
Development Worker из **смонтированной только для чтения** директории.

Источники отчёта:
- `amurskmarket.ru` — публичные технические HTTP-проверки;
- `vozdooh27.ru` — публичные технические HTTP-проверки;
- `business-kpi` — Docker state на Амурске;
- `purchasing` — Docker state на Амурске;
- `arthur` — Docker state на Амурске.

Текст не раскрывает локальные пути, секреты или подробные диагностические
сообщения. Данные старше двух часов, повреждённые данные, дубликаты,
недоступный каталог и незнакомые проекты **не объявляются исправными**.
Статус `healthy` означает только техническую доступность, а не
успешность работы эквайринга, заказов и интеграции 1С.

## Амурск — действующая конфигурация

- Ресурс монитора на Windows:
  `C:\AI-Ecosystem\local-services\arthur-dev-worker-reports`;
- mount в Telegram Gateway:
  `/var/lib/arthur-project-health:ro`;
- `ARTHUR_DEV_WORKER_REPORT_DIR=/var/lib/arthur-project-health`;
- образ: `arthur-core-telegram-gateway:project-health-v2-20261009`;
- исходный compose: `docker/arthur/compose.yml` и локальный
  `docker/arthur/compose.override.yml`;
- backup предыдущего override:
  `C:\AI-Ecosystem\candidates\arthur-project-status-20261009\compose.before-projects-v2.yml`.

Рабочая задача `Arthur-Dev-Worker-Health` на Windows продолжает каждый час
формировать снимок. Новая команда **не запускает** сбор данных и не обращается
к платным DeepSeek/GLM — только читает сохранённое состояние.

## Результаты

- Изолированный Docker smoke в production-like окружении: **11/11 PASS**.
- После canary: runtime `11/11 PASS`, свежий снимок `FRESH_REPORT=true`,
  все пять зарегистрированных проектов распознаны.
- Регрессия клиент Telegram + Business KPI skill: **26/26 PASS**.
- Docker Gateway: **healthy**, `RestartCount=0`, состояние образа закреплено
  в default Docker Compose, отчёты read-only.
- Реальный входящий `/projects` от пользователя и подтверждённый
  Telegram-ответ **пока не проверен**. Нельзя запускать отдельный
  `getUpdates` параллельно работающему polling-клиенту.

## Следующее

1. Реальное подтверждение входящего `/projects` в Telegram и ответа.
2. Нотификация владельцу при двух последовательных `degraded` снимках
   одного сервиса (с дедупликацией, без токенов и спама).
3. Read-only health расширить глубокими функциональными проверками KPI
   (без 1С пока не подключена), закупщика и коммерческих путей VOZDOOH.
4. Development Worker v2 в изолированных Git worktree, проверка тестов,
   review, контролируемый deploy/rollback и подтверждение прав на запись.
