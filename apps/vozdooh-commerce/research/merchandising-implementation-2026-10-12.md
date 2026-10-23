# Demand merchandising — 2026-10-12

## Inventory verification

Read-only comparison of /opt/vozdooh/data/catalog-staged.json against demand-evidence-2026-09.json: the positive-stock SKU set, stock and original names match exactly: **148 SKU / 220 units**. Whole-file hashes are deliberately not used as the inventory identity. No source catalog writes. External demand evidence remains the 2026-09-24 verified research.

## Implementation

The compact merchandising allowlist promotes only four CORE and ten STRONG SKUs; remaining products retain their previous brand/slug order. Existing TOP-25 metadata remains available for existing PDP SEO. High-stock push is independent and does not confer popularity. No prices, discounts, payments or delivery changes.

Homepage: one representative per fragrance. Brand bestsellers show Aramara Decor 250 and Tessuto Stile 250; popular fragrances show Les Secrets d’Antoine 200, Mareminerale car sachet, Aqqua Decor 250, Dolce Vaniglia 500, Bianco Divino 500 and NIRO 250. Other formats are linked on PDPs. /collections/popular holds all 14; no additional bestseller URL or new-arrival claim. Category, brand and character landings retain their real-stock metadata rules.

Both sections explain that external signals are not VOZDOOH sales statistics. Bestseller evidence is fragrance-level, not a claim that each bottle size is a bestseller. No research scores or internal tiers are rendered.

## Card gap audit

Existing descriptions, translations, images and scent profiles were reused. Collection names remain in confirmed original/display names (CULTI Decor/Stile Classic); unconfirmed collections and Russian translations remain unset. Volume/type and brand use existing staged presentation. SEO title/description already cover all 14 through the priority PDP path.

| SKU | Display name | Russian title | Notes/profile | Exact local image | Existing same-fragrance links | Change |
| --- | --- | --- | --- | --- | --- | --- |
| 802e8ae5-d19b-11ec-be83-7c8bca00854e | Decor Classic Aramara | Not confirmed; original retained | горький апельсин, бергамот, сандал; citrus | /catalog/official/802e8ae5-d19b-11ec-be83-7c8bca00854e.jpg | culti-decor-aramara-1000, culti-stile-aramara-250 | Reused existing content |
| bf33a951-016c-11ed-b2a4-7c8bca00854e | Decor Classic Aramara | Not confirmed; original retained | горький апельсин, бергамот, сандал; citrus | /catalog/official/bf33a951-016c-11ed-b2a4-7c8bca00854e.jpg | culti-stile-aramara-250, culti-decor-aramara-250 | Reused existing content |
| df29d344-d192-11ec-be83-7c8bca00854e | Stile Classic Aramara | Not confirmed; original retained | горький апельсин, бергамот, сандал; citrus | /catalog/official/df29d344-d192-11ec-be83-7c8bca00854e.jpg | culti-decor-aramara-1000, culti-decor-aramara-250 | Reused existing content |
| df29d346-d192-11ec-be83-7c8bca00854e | Tessuto | Ткань | листья кассиса, цветы хлопка, жасмин, белый мускус; floral | /catalog/official/df29d346-d192-11ec-be83-7c8bca00854e.jpg | No confirmed stocked alternative | Reused existing content |
| N020458 | LES SECRETS D'ANTOINE | Not confirmed; original retained | мандарин, розовое дерево, мускус; woody | /catalog/official/N020458-nebo.jpg | No confirmed stocked alternative | Reused existing content |
| 802e8b0c-d19b-11ec-be83-7c8bca00854e | Саше для автомобиля Mareminerale 7х7см | Not confirmed; original retained | морской аккорд, сок растений, минеральный мускус; fresh | /catalog/official/802e8b0c-d19b-11ec-be83-7c8bca00854e.jpg | No confirmed stocked alternative | Removed indoor room/season/year claims from car format |
| 976878 | Decor Classic Aqqua | Not confirmed; original retained | кориандр, бергамот, мимоза, шалфей, сандал; fresh | /catalog/official/976878.jpg | culti-aqqua-room-spray-100, culti-stile-aqqua-250 | Reused existing content |
| bf33a957-016c-11ed-b2a4-7c8bca00854e | Aqqua | Not confirmed; original retained | кориандр, бергамот, мимоза, шалфей, сандал; fresh | /catalog/official/bf33a957-016c-11ed-b2a4-7c8bca00854e.jpg | culti-decor-aqqua-250, culti-stile-aqqua-250 | Reused existing content |
| df29d34a-d192-11ec-be83-7c8bca00854e | Stile Classic Aqqua | Not confirmed; original retained | кориандр, бергамот, мимоза, шалфей, сандал; fresh | /catalog/official/df29d34a-d192-11ec-be83-7c8bca00854e.jpg | culti-aqqua-room-spray-100, culti-decor-aqqua-250 | Reused existing content |
| 655467 | DOLCE VANIGLIA | Сладкая ваниль | сахарная пудра, карамель, тёмный шоколад, цветок ванили, белый мускус, ваниль, бобы тонка; warm | /catalog/official/655467.png | teatro-dolce-vaniglia-250, teatro-dolce-vaniglia-refill-500 | Reused existing content |
| DV250TFU | DOLCE VANIGLIA | Сладкая ваниль | сахарная пудра, карамель, тёмный шоколад, цветок ванили, белый мускус, ваниль, бобы тонка; warm | /catalog/official/DV250TFU.png | teatro-dolce-vaniglia-500, teatro-dolce-vaniglia-refill-500 | Reused existing content |
| BD500TFU | BIANCO DIVINO | Not confirmed; original retained | виноград Шампань, яблоко, лимон, сладкий апельсин, болгарская роза, глициния, гвоздика, фиалка, белый мускус, бамбук, сандал; floral | /catalog/official/BD500TFU.png | No confirmed stocked alternative | Reused existing content |
| DV500RTFU | DOLCE VANIGLIA | Сладкая ваниль | сахарная пудра, карамель, тёмный шоколад, цветок ванили, белый мускус, ваниль, бобы тонка; warm | /catalog/official/DV500RTFU.png | teatro-dolce-vaniglia-250, teatro-dolce-vaniglia-500 | Reused existing content |
| DANHNIR250DEC | NIRO | Not confirmed; original retained | кипарис, элеми, озон, личи, перуанский бальзам, сандал, уд, пачули; woody | /catalog/official/DANHNIR250DEC.jpg | No confirmed stocked alternative | Added structured NIRO notes/profile from existing exact-article evidence |

NIRO use scenario remains the existing editorial bedroom suggestion, not a manufacturer recommendation. Its notes come from the exact article documented in research (Bosco/TSUM); no duration claim added. Mareminerale explicitly remains a car-use product; indoor placement is not transferred to the sachet. Existing reciprocal Aramara/Aqqua/Dolce links are preserved; recommendation resolution now excludes zero-stock targets. Single-format scents receive no invented alternative.

## Analytics and validation

Existing AnalyticsLoader, ecommerce and filter_use are unchanged. view_merch_section fires once on section visibility; select_merch_item adds SKU and section ID on card selection. A strict payload whitelist discards all additional fields. Without a configured counter, merch events are a no-op.

Run npm run verify and git diff --check before commit. The demand-merchandising tests cover exact order, evidence sets, filtering, rendered homepage claims, all 14 local assets/profiles, reciprocal stocked variants and analytics privacy.

## Next stage

Review the homepage visually on target devices with staged configuration before any production release. Measure section engagement after analytics activation; external signals alone do not predict sell-through. Independently verify missing collection/translation/alternate-format evidence before adding content. No production deployment in this change.
