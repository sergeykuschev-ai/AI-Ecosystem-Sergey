# Arthur Functional Monitor v1 — проверка реальных контрактов без записей

## Готово (09.10.2026)

Отдельный read-only монитор `scripts/arthur/dev-worker/functional_runner.js`.
Он проверяет не только наличие процесса Docker, но и ожидаемое содержимое
действующих страниц и контракты двух внутренних API.

### Проверки (13)

Сайт **amurskmarket.ru**:
- главная: присутствуют четыре магазина и информация о бонусах;
- страница «Миска»: заголовок и зоомагазин;
- бонусы: ожидаемое содержимое;
- sitemap.xml: XML-маркер и домен.

Сайт **vozdooh27.ru**:
- главная: маркер VOZDOOH;
- каталог: «Каталог» и VOZDOOH;
- корзина: «Корзина» и VOZDOOH;
- страница оформления заказа: «Оформление заказа» и VOZDOOH;
- /api/health: валидный JSON со статусом ok.

Windows Amursk:
- business-kpi-local-web: GET /health возвращает PostgreSQL
  checked=true, healthy=true и mode=AUTH_REQUIRED;
- business-kpi-local-web: GET /api/business-kpi/dashboard **без ключа**
  возвращает 401 (проверка защиты данных);
- purchasing-web-backend: GET /api/v1/health возвращает status=ok,
  service=purchasing-web;
- purchasing-web-backend: GET /api/v1/owner-learning/knowledge-health
  возвращает валидную read-only структуру с полем findings.

Все обращения GET без авторизации. Внешние адреса и названия контейнеров
жёстко определены в коде (allowlist); произвольные команды, URL,
запись в БД, 1С, настоящие заказы и оплаты запрещены.

### Планировщик, хранение и безопасность

- Работает на **сервере Амурска**, не на VPS.
- Задача Windows: `Arthur-Functional-Monitor`, каждые 3 часа,
  запуск Node.exe как SYSTEM, без shell от LLM.
- Первый контрольный запуск под SYSTEM прошёл с `LastTaskResult=0`,
  результат: 13/13 `healthy`.
- Отчёты: `C:\AI-Ecosystem\local-services\arthur-functional-reports`;
  защищённые Windows ACL. Отдельные JSON-отчёты `functional-*.json`,
  максимум 96 снимков, append-only.
- Существующий `Arthur-Dev-Worker-Health` работает **отдельно каждый час**.
  Он продолжает контролировать доступность и отправлять Telegram
  уведомления только после двух последовательных сбоев.
- Функциональный монитор **не подключён к автоматическим аварийным
  уведомлениям**, чтобы не создавать ложные тревоги.

### Проверка

- Linux/VPS unit tests: 8/8 PASS; 9 из 9 публичных проверок прошли.
  Windows-container checks на VPS корректно помечаются not_checked.
- Windows native unit tests: 8/8 PASS.
- Windows manual live run: 13/13 `healthy`.
- Windows Scheduled Task под SYSTEM: 13/13 `healthy`, exit 0.
- Дополнительно штатный smoke `amurskmarket.ru`: 16/16 PASS.

### Важные ограничения

Страницы корзины и оформления проверены как страницы сайта, но не
проводится создание заказа, выбор действительного ПВЗ, реальная оплата,
проверка остатка по SKU, отправка email, экспорт XLSX или 1С.
KPI PostgreSQL подтверждён как доступный, **достоверность выручки,
эквайринга и данных продавцов ещё не проверена**. Заказ в закупщике
не формировался и поставщику не отправлялся.

Следующий этап: read-only проверки фактических KPI по всем магазинам,
отображение отдельного функционального статуса в `/projects`, безопасный
отчёт по последним заказам закупщика и VOZDOOH (без изменения записей).
