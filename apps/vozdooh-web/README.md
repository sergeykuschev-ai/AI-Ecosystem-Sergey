# vozdooh-web

Витрина магазина ароматов для дома VOZDOOH (Next.js App Router).

## Команды

```bash
npm install
npm run dev        # локальная разработка
npm run test       # тесты (node --test + tsx)
npm run lint       # eslint, без предупреждений
npm run typecheck  # tsc --noEmit
npm run build      # production build
```

## Структура

- `app/brands/` — страницы `/brands` и `/brands/[slug]` (бренд-лендинги).
- `components/brands/` — компоненты брендовых страниц.
- `lib/brands/` — исследовательский слой брендов: факты со статусом
  `verified` (только с указанным источником из репозитория) или `needs_source`
  (не публикуются на страницах).
- `lib/catalog/` — начальный срез каталога (товары и связи с брендами).
  Полный каталог и карточки товаров — в задаче #199.
- `lib/seo/` — построение metadata и JSON-LD только из проверенных фактов.
- `research/brand-audit-2026-10.md` — аудит брендов: что подтверждено, что требует источника.
- `tests/` — проверки целостности «бренды ↔ каталог» и публичного контракта страниц.

## Окружение

- `NEXT_PUBLIC_SITE_URL` — абсолютный базовый URL для canonical, sitemap и
  structured data. Без него используется `http://localhost:3000` (только для
  локальной разработки и проверок).

## Правило публикации фактов

Публичные страницы показывают только утверждения со статусом `verified`.
Всё остальное хранится как `needs_source` и никогда не рендерится в HTML,
metadata и JSON-LD (это покрыто тестами `tests/`).
