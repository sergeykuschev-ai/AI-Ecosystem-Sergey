# Arthur OS — Changelog

## 2026-08-23

### Business KPI Web v1

- Manual Web UI для смен, Dashboard, сотрудников, импорта и экспорта реализован и проверен.
- Historical XLSX bulk import реализован с dry-run, atomic commit, reconciliation, validation report и историей import runs.
- Изолированный PostgreSQL acceptance завершён со статусом PASS на базе `business_kpi_test`; production deployment не выполнялся.
- Реальные KPI XLSX за май–август сверены с нулевыми отклонениями: `0.00 ₽` по выручке и `0` по чекам для каждого месяца.
- CRUD, duplicate protection, soft delete, append-only audit, transaction rollback, money precision, date roundtrip, export и persistence после restart проверены в PostgreSQL.
- Интеграция с 1С не подключена.
- Repository-wide Windows/Purchasing failures воспроизведены на чистом `origin/main` и зафиксированы как baseline, не вызванный Business KPI.

## 2026-07-29

### Added

- Зафиксирована единая архитектура Arthur OS.
- AI-закупщик определён как готовый навык Артура.
- Добавлены обязательные модули личного ассистента, Instagram и Академии Миски.
- Зафиксированы порядок разработки, модель безопасности и правила подтверждений.
- Создан канонический комплект документации `docs/arthur/`.