# VOZDOOH — исправление синтетического браузерного теста оплаты
Дата: 18 октября 2026 года. Статус: **проверенный кандидат, ожидает согласования**.

## Что исправлено
- Тестовый платёж не возвращает paid до вызова перехваченного /api/payments/ozon/create. Фоновый опрос до запуска оплаты остаётся pending.
- Подсчёт purchase учитывает обе открытые вкладки и выявляет дубли событий.
- Новые тесты моделируют 8 сценариев, включая отложенный paid, повторный учёт, неуспешный платёж и сохранение новых позиций корзины.
- Это изменения только тестового harness, его fixture/tests и документации. Продуктовый код, правила оплаты, backend, реальные заказы и 1С не изменены.

## Фактически выполненная независимая проверка
- Код создан Codex в изолированной ветке codex/task-c6e1f631-a2e7-479f-8f2e-836fcfca36cf от ревизии 0401235.
- Исходное задание Arthur завершилось failed / UNAPPROVED_FILE_CHANGE: Codex создал helper в scripts/, вне разрешённого списка. История задания сохранена неизменной.
- После ручной проверки helper перенесён в tests/, импорты поправлены без расширения allowlist.
- Синтетические unit-тесты helper: **9/9 PASS**; строгая проверка файлов: **4/4 допустимых файла**, отдельные security regression тесты валидатора: **3/3 PASS**.
- Независимый полный gate: **5/5 PASS** — Linux Node.js, Linux Python, TypeScript, ESLint и изолированная сборка Next.js.
- Реальный Chrome на localhost:3437 с синтетическим локальным каталогом: **16/16 PASS** (8 сценариев × 390 и 1280 px), exit 0. Запросы создания заказа и оплаты перехвачены тестом.
- Журналы и SHA256: C:\AI-Ecosystem\candidates\arthur-vozdooh-first-live-check-20261018\REMEDITATION_REGRESSION.json и browser-candidate-16.log.
- Ранее появившиеся qa-*.log заархивированы вне Git worktree. Созданный Next.js временный diff next-env.d.ts восстановлен.
- Результат ещё не слит в базовую ветку, не опубликован и не развернут на сайте. Публикация требует отдельного согласования.

## Состав кандидата
- apps/vozdooh-web/scripts/verify-paid-cart-browser.cjs
- apps/vozdooh-web/tests/paid-cart-qa-state.cjs
- apps/vozdooh-web/tests/paid-cart-qa-state.test.cjs
- apps/vozdooh-web/docs/paid-cart-qa-candidate-20261018.md
