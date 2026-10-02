# VOZDOOH — pre-launch audit, 2 октября 2026

Issue: #203. Scope: `apps/vozdooh-web/`. Проверка выполнена без production deploy и без создания реального заказа Ozon Delivery.

## PASS

- Реальный staged-каталог 1С: 148 SKU с положительным остатком; 144 карточки опубликованы, 144/144 product routes возвращают HTTP 200.
- Критические страницы: `/`, `/catalog`, `/brands`, `/categories`, `/collections`, `/finder`, `/cart`, `/checkout`, `/delivery`, `/payment`, `/returns`, `/contacts`, `/privacy`, `/offer`, `/user-agreement` — HTTP 200; неизвестный URL — HTTP 404.
- Проверено 172 уникальных внутренних ссылки из главной/каталога/информационных страниц: битых ссылок 0.
- Footer содержит каталог, подбор, бренды, коллекции, корзину, доставку, оплату, возврат, контакты, privacy, оферту и пользовательское соглашение.
- Полный test suite после исправлений: 88/88 Node app tests + 2/2 CommerceML tests + 9/9 Python tests.
- `npm run typecheck` — PASS; `npm run lint` — PASS.
- Production `next build` со staged-1C — PASS, Turbopack warnings: 0.
- 404/error/checkout regressions покрыты существующими тестами; checkout требует email и отдельное согласие на будущий маркетинг.

## FIXED

- Убраны 7 Turbopack warnings о dynamic filesystem tracing для order store / payment routes / email outbox без изменения runtime-семантики.
- Убраны lint-проблемы checkout: лишний автоматический PVZ side effect и небезопасные `any` в разборе ответа Ozon Pay заменены проверяемой структурой.
- `/payment` больше не утверждает, что онлайн-оплата отключена: текущий flow честно описывает Ozon Pay после серверной проверки корзины.
- `/delivery` приведена в соответствие с текущим checkout: выбор ПВЗ Ozon работает, но доставка пока не добавляется к сумме Ozon Pay автоматически.

## BLOCKED_EXTERNAL

- Автоматическая цена Ozon Delivery до оплаты ещё не подключена. Production использует Ozon Delivery for Business (`api-delivery.ozon.ru`, OAuth `delivery-api.all`).
- Текущий server client содержит метод Seller API `/v2/delivery/checkout`; read-only live probe к Business API на этом пути вернул HTTP 404. Для Business Delivery API используется `/v1/order/checkout`; требуется реализовать именно его контракт.
- Для расчёта Business Delivery нужны логистические параметры посылки. В staged 1C нет веса, длины, ширины и высоты. До подтверждённых данных нельзя подставлять выдуманные значения.
- Автоматическое создание отправления Ozon Delivery после оплаты пока не является частью публичного checkout; до его реализации отправка остаётся операционной/manual стадией.

## NEEDS_SOURCE

- 4 SKU из product-card audit остаются без точного подтверждённого изображения: `445445`, `121211`, `045850b2-9e1f-11ee-b408-d069cd63062f`, `0189`.
- Для реальных SKU нужно собрать подтверждённые shipping weight + L/W/H. Объём товара нельзя автоматически считать весом, а две опубликованные размерности нельзя превращать в три.
- PR #206 по issue #204 нельзя использовать как результат: агент не видел `/opt/vozdooh/data/catalog-staged.json` и сформировал dataset с 0 SKU.

## MANUAL_LIVE_TEST

- После следующего deploy: пройти checkout на мобильном и desktop с реальным ПВЗ, проверить Ozon Pay redirect/result callback и отсутствие повторного платежа при retry.
- Проверить получение `request_received` и `payment_confirmed` на реальный email через production SMTP/outbox, без использования тестовых адресов как доказательства массовой доставляемости.
- После внедрения `/v1/order/checkout`: проверить реальный расчёт тарифа на одной тестовой корзине и сверить сумму/срок с кабинетом Ozon Delivery перед включением для всех покупателей.
- Реальное создание/подтверждение отправления и списание денег за логистику выполнять только отдельным контролируемым тестом; этот аудит намеренно не создаёт отправления.

## Launch gate

Кодовая витрина, каталог, навигация, SEO-gate, checkout validation, Ozon Pay и сервисные email-механизмы проходят автоматические проверки. Публичный запуск с обещанием «доставка рассчитана и включена до оплаты» пока закрыт: сначала требуется реальный dataset логистических параметров и интеграция Ozon Delivery for Business `/v1/order/checkout`.
