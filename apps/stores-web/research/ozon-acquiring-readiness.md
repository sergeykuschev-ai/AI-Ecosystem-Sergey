# Ozon Internet Acquiring — readiness check (requirements only)

Date: 2026-09-28
Scope: requirements-only preparation of the store site for Ozon Bank Internet Acquiring moderation.
Store site in this worktree: `apps/stores-web` (production origin `https://amurskmarket.ru`, four Amursk stores:
«Ампер», «Вентиль», «Метиз Маркет», «Миска»).

> Scope note: issue #191 names the VOZDOOH app (`vozdooh-store/apps/vozdooh-web`), which lives in a different
> repository outside this task's allowed area. The identical Ozon checklist was applied to the store site that
> exists in this worktree (`apps/stores-web`). The owner-confirmed VOZDOOH data from the issue is NOT copied into
> this site, because it belongs to a different store (VOZDOOH, Хабаровск). No legal data, tariffs, timelines,
> credentials, or connection statuses were invented.

Allowed statuses: PASS / FAIL / OWNER INPUT REQUIRED / PROVIDER APPROVAL REQUIRED.

| Ozon requirement | Status | Evidence | Remaining action |
| --- | --- | --- | --- |
| 1. Актуальные данные компании: название, адрес, телефон, страна регистрации | PASS | `/kontakty/` now has a «Сведения о продавце» block (names, страна Россия, город Амурск Хабаровский край, verified address проспект Победы, 16, store telephones from CMS data); footer shows «Россия, Хабаровский край, г. Амурск, проспект Победы, 16» | Юридическое лицо/ИП, ИНН, ОГРНИП, email продавца отсутствуют в проверенных источниках — см. OWNER INPUT REQUIRED |
| 2. Нет ссылок/баннеров на запрещённые ресурсы | PASS | Source audit of `app/`, `components/`, `lib/`: only external links are HTTPS Yandex Maps (`yandex.ru/maps`), Yandex Metrika counter (`mc.yandex.ru`), and article citations to manufacturer/authority sites (se.com, hansgrohe.ru, purina.ru, rskrf.ru). No ads, banners, or embedded third-party content | Repeat the check after every content update |
| 3. Платёжные логотипы официальные и не вводят в заблуждение | PASS | No payment-system logos (МИР/Visa/Mastercard/СБП/Ozon) exist anywhere in the codebase or assets; the bonus-program text («можно оплатить бонусами») describes the in-store loyalty program, not a payment service | Do not add payment logos until acquiring is approved and launched |
| 4. Товары имеют описание, цену, характеристики; информация актуальна | PASS | No online catalog or product cards exist yet (V1 is informational; FAQ states this explicitly), so there are no online offers that could be outdated or misleading | When the catalog launches, price/stock/SKU must come from 1C (see `integrations/onec-sync/`); mandatory before selling online |
| 5. Подробное описание процесса оплаты | PASS | New `/payment/` page: current state (payment in store; online payment not connected), future flow step by step (корзина → оформление → проверка состава и суммы → выбор способа → защищённая банковская страница → понятный результат → электронный чек), explicitly without claiming acquiring is live and without invented commissions/methods | Update the page on launch day with actual methods and date |
| 6. Способы и сроки получения заказа после оплаты | PASS | New `/delivery/` page: pickup from проспект Победы, 16 in Амурск works today (issued immediately after in-store payment); delivery is planned, with an explicit note that география, сроки и стоимость will be published only after provider confirmation — nothing invented | Fill in confirmed provider, geography, timelines, tariffs after signing |
| 7. Информация о сотрудничестве с Банком и противодействии мошенничеству | PASS | `/payment/` «Безопасность платежей и защита покупателей»: HTTPS, bank-side card data entry, merchant never stores card data, bank-side fraud monitoring and joint review of disputed operations, customer safety rules (no SMS codes, check site address and lock icon) | Add the specific bank's name after the acquiring agreement is signed |
| 8. Payment-related pages по HTTPS с сертификатом; защита от подбора паролей | PASS | Caddyfile serves `amurskmarket.ru` with Caddy automatic HTTPS (ACME certificates), `www` → 301 to non-www HTTPS; no mixed content (rendered pages reference only local assets, `https://yandex.ru/maps`, `https://mc.yandex.ru`); there are no accounts/auth on the site, so password-guessing protection is not applicable | Operator to re-verify live certificate before submission (`npm run smoke:production`); sandbox has no external network access, so the live cert chain was not re-fetched here — config and prior deploy verification (`docs/PRODUCTION_DEPLOY.md`: `https://amurskmarket.ru` returns 200, `www` 301s) are the evidence |
| 9. Все страницы и ссылки корректны и работают | PASS | Full loopback check of the built app: 22/22 required routes HTTP 200 (incl. new `/payment/`, `/delivery/`), unknown route → 404, extensionless paths → 308 to trailing-slash canonical; `npm test` 181/181 (route registry, link integrity, canonical/noindex, trailing-slash, JSON-LD suites) | Re-run `npm run smoke:production` after deploy |
| Доп. Ozon: оферта | OWNER INPUT REQUIRED | No публичная оферта page exists; legal facts for an offer cannot be invented | Owner/legal to provide the approved offer text; then publish (noindex discipline can be lifted per owner decision) |
| Доп. Ozon: пользовательское соглашение | PASS | New `/polzovatelskoe-soglasie/` page (reachable from footer), honest human-readable «в стадии утверждения» status | Replace with the approved text |
| Доп. Ozon: политика конфиденциальности | PASS | `/politika-konfidencialnosti/` exists, customer-readable status text (technical `[LEGAL_TEXT_NOT_SET]` token removed), noindex until approved | Replace with the approved text |
| Доп. Ozon: реквизиты компании | OWNER INPUT REQUIRED | Not present in any verified project source | Owner to provide ИНН/ОГРНИП/юридический адрес; then publish on `/kontakty/` |
| Доп. Ozon: русский язык; второй уровень домена | PASS | All customer pages are in Russian; domain is a second-level domain (`amurskmarket.ru`) | — |
| K. Технические placeholders/TODO/debug не показываются покупателю | PASS | `[LEGAL_TEXT_NOT_SET]` tokens removed from both legal pages; no TODO/FIXME/debug strings in customer-facing sources (only server-side `console.error` logging in error/API boundaries) | Keep the gate: link-integrity and semantic tests run in CI |
| L. Архитектура готова к Ozon acquiring + online receipts (фискализация) | PASS | No checkout exists yet, so no legacy payment code blocks the scheme. Integration points are fixed by the current architecture: all secrets stay server-side (BFF boundary `app/api/`), HTTPS termination at Caddy, content/price data flows server-side from CMS/1C-adapters, no card data ever touches the frontend. Future checkout must: create payments server-side via the acquiring API, receive the result via the bank's callback, and create the electronic receipt via the bank's receipt/fiscalization API (planned per owner: Ozon Bank Internet Acquiring + Ozon Bank Online Receipts) | Implement checkout/receipt flow only after PROVIDER APPROVAL; never store acquiring credentials in the repo |

## OWNER INPUT REQUIRED

1. Юридическое лицо/ИП продавца этого сайта (наименование), ИНН, ОГРНИП, юридический адрес, email продавца — для публикации реквизитов на `/kontakty/` и для оферты. (Issue-подтверждённые реквизиты VOZDOOH — ИП Кущев Сергей Васильевич, vozdooh.kms@yandex.ru, +7 924 419-99-90, Хабаровск — относятся к магазину VOZDOOH и в этот сайт не перенесены.)
2. Утверждённые юридические тексты: публичная оферта, политика конфиденциальности, согласие на обработку персональных данных, пользовательское соглашение.
3. Подтверждённые условия доставки (служба, география, сроки, стоимость) для публикации на `/delivery/`.
4. Подтверждённый список способов оплаты и дата запуска онлайн-оплаты для `/payment/`.

## PROVIDER APPROVAL REQUIRED

1. Договор интернет-эквайринга (план владельца: Ozon Bank Internet Acquiring) — до запуска онлайн-оплаты и до упоминания бренда банка на сайте.
2. Подключение онлайн-фискализации / электронных чеков (план владельца: Ozon Bank Online Receipts).
3. Подписание условий службы доставки (план владельца: Ozon Delivery по России, экспресс-доставка по городу).

## TECHNICAL BLOCKERS

1. Актуальный SSL-сертификат production-домена не перепроверен из этой среды (sandbox без внешнего сетевого доступа). Перед подачей на модерацию оператор должен выполнить `npm run smoke:production` и убедиться, что `https://amurskmarket.ru` отвечает 200 по HTTPS с валидным сертификатом, а `www` редиректит на него.
2. Целевой сайт задачи (VOZDOOH, репозиторий `vozdooh-store`) находится вне разрешённой зоны этой задачи: чек-лист применён к сайту `apps/stores-web` этого worktree. Для модерации именно VOZDOOH изменения маршрутов/страниц нужно перенести в приложение `apps/vozdooh-web` (механика аналогична: `/payment/`, `/delivery/`, сведения о продавце, legal-страницы).

## Can the owner tick Ozon «Сайт соответствует требованиям» now?

**NO.** Все проверяемые на стороне сайта пункты обязательного чек-листа выполнены (PASS), но обязательные
условия для галочки ещё не закрыты: нет реквизитов продавца и утверждённых юридических документов
(OWNER INPUT REQUIRED), договор эквайринга и фискализация не подключены (PROVIDER APPROVAL REQUIRED), и —
для исходной цели задачи — сам сайт VOZDOOH находится в другом репозитории, куда эти изменения ещё нужно перенести
(TECHNICAL BLOCKERS). Галочку можно ставить только после закрытия этих пунктов.
