# Catalog cleanup evidence — 24 September 2026

Scope: presentation/editorial only, based on clean `218f8ba2`, the 148 positive-stock SKU research and the read-only staged snapshot. No source, stock, barcode, trade name, price, demand tier or demand rank changes. This is an editorial supplement to the frozen demand study, not a recalculation of demand.

## Confirmed changes

- **VINOVE names:** exact source names already include both city and collection for `N020445`, `N020438`, `N020434`, `N020325`, `0b044a39-8588-11ed-b530-7c8bca00854e`. The former slash truncation selected the generic type. New SKU + brand + exact source-name bindings show those existing facts; no translation or fragrance facts added. Rome Evolution Excellence and Rome Leather Espresso stay distinct.
- **CULTI `65576`:** [official Automobili Lamborghini 1000 ml](https://www.culti.com/en/diffusore-1000-ml-automobili-lamborghini.html), opened live. Corrected editorial display spelling only. No Limited claim, collection attribution or rank change; physical finish/edition still requires comparison.
- **Aramara 250 ml:** [official Stile](https://www.culti.com/it/diffusore-stile-aramara-250ml.html) and [official Decor](https://www.culti.com/en/diffusore-decor-aramara-250ml.html), both opened live. Distinct product pages confirm two collections. Existing SKU, slugs, images and names stay distinct; regression covered.
- **Bianco Divino `BD500TFU`:** [official diffuser 500 ml with sticks](https://teatrofragranzeuniche.it/eu/bianco-divino-ml-500-with-sticks) returned detailed indexed product text including format, volume and pyramid; direct open failed. [De-light exact BD500TFU](https://www.de-light.ru/catalog/teatro/diffuzor-bd500tfu-bianco_divino/) indexed title corroborates the manufacturer article; direct open failed. Format uncertainty is resolved at catalog level. No claim about a particular production year's bottle or collection; no linen-spray facts imported.
- **Millefiori `22fimr`:** [official Mimosa Flower](https://millefiorimilano.com/en/products/selected-water-soluble-fragrance-mimosa-flower), opened live: water-soluble, 15 ml, Hydro ultrasonic use. Specific category added. Existing description is supported. No demand promotion.
- **Refills/accessories:** current source names and the existing demand study's `product_type` distinguish refills from diffusers and TEATRO boxes of sticks from filled bottles. Parser precedence corrected; gift sets remain sets. Accessory subtitle no longer describes the destination bottle's ml as the accessory's own volume. Counts remain SKU counts, never individual sticks.
- **Review scope:** [Lothantique Canada](https://lothantique.ca/products/lothantique-200ml-diffuser-refill-sandalwood), opened live, is explicitly a refill. `N020465` remains a diffuser. `V63011` wax-review limitation remains as recorded in the demand study; no new review claim or copied rating. Both customer descriptions are regression-checked to contain no review/rating claims.

## AROMAgroup: 24 of 27 descriptions improved

[The brand's Belarus representative catalog](https://aroma-group.by/aromaty/) was opened live and its exact named fragrance sections inspected. The [representative homepage](https://aroma-group.by/) identifies the relationship. This is fragrance-level evidence; it establishes neither the cartridge connector nor compatibility with a particular apparatus. Only brief note summaries are used; marketing claims about sales, health, mood, coverage and runtime are excluded. Exact SKU/source-name/brand guards in `reviewedContent.ts` prevent carryover to a renamed import. Every new description requires compatibility confirmation by model.

| Named fragrance section | Bound SKU |
|---|---|
| Игристая малина | `323244211`, `876687` |
| Бали | `454569087` |
| Пина колада | `7c1b6caa-5341-11ed-8c25-7c8bca00854e` |
| Розовое просекко | `3246675` |
| Кофе с ликёром | `33421956` |
| Табак и ваниль | `5432311112` |
| Текила Санрайз | `223211` |
| Бордо | `32131`, `87654` |
| Тадж-Махал | `787532`, `5445098`, `087654` |
| Мальдивы | `0789`, `088976` |
| Магма | `99889898`, `45360` |
| Красное дерево | `2332` |
| Пачули | `3534657` |
| Салями | `045850b2-9e1f-11ee-b408-d069cd63062f` |
| Кофе Масала | `084e10f7-dad6-11ee-b40a-f198e863aac1` |
| Тонка и жакаранда | `fcf32570-dad6-11ee-b40a-f198e863aac1` |
| Пряный табак | `1112211` |
| Джованни | `3444567` |

The `ё/е` and spacing differences are recorded through exact source bindings, not fuzzy matching. `132689` (Благородная кожа) was not found in that catalog. The two service liquids have no scent pyramid. These three retain fallback descriptions. The original 27-item set contains no apparatus SKU; existing apparatus descriptions were not expanded with new specifications.

## Missing-image and unknown-brand review

No new image was downloaded or assigned. An exact scent name alone cannot establish cartridge packaging. A publicly visible image does not establish permission to reuse it. Existing local image mappings were left untouched.

| SKU | Search/evidence checked | Disposition |
|---|---|---|
| `98049E` | Exact article search; [official WoodWick](https://www.yankeecandle.co.uk/woodwick/candles/shop-by-type/mini-jars/coastal-sunset-candle/SAP_98049E_PR.html) explicitly says Coastal Sunset, 85 g | Conflicts with source Spiced Blackberry. No image or aroma assigned. Physical label needed. |
| `9a227639-b1a0-11ed-a1a3-7c8bca00854e` | `AROMAgroup "Жидкость для промывки" картридж`; [Megadez 110 ml](https://megadez.pro/produktsiya/aromatizatsiya/ag-zhidkost-dlya-promyvki-110-ml/) names format | Retailer page does not bind internal SKU/packaging or image permission. Keep hidden. |
| `4356` | Same service-liquid search, current source 150 ml vs retailer 110 ml | Volume mismatch; no image transfer. |
| `445445` | Exact SKU/microUSB and source wording searches; [Rexant distributor](https://www.rexant.kz/catalog/setevye/?catalog_order=asc&catalog_sort=rating&catalog_view=table) lists a 1.2 m candidate with a different article | Not a match. Brand, electrical ratings and compatibility unknown. No inferred specs/image. |
| `1113` | Exact SKU + ротанговые палочки 1000мл | No reliable exact identity/brand/photo found. Bottle volume is not sufficient identification. |
| `121211` | Exact SKU + ротанговые палочки 500мл | Same limitation; remains separate from 1113. |
| `N020486` | Exact SKU and full descriptive wording; [Milfey 18-piece candidate](https://milfey-shop.ru/amelie-et-melanie/tip_sredstv-palocki_dla_diffuzora) | Count alone cannot establish brand. No label/article match. Suspect 23 × 3 mm claim removed from editorial; raw name retained in details. |
| `344565` | Exact article and Lui&Lei black gold searches; [Ladenac collection history](https://www.ladenac.com/en/presents-in-casa-decor-with-vila-hermanos), [2025 redesign](https://www.ladenac.com/en/ladenac-milano-returns-to-maisons-objet-in-2025-an-ode-to-design-decoration-and-haute-parfumerie), [LeMa catalog](https://lemaaroma.com/karta-sajta/) | Jet Lag Black Gold is a candidate, not a confirmed physical SKU match. Collection changed over time. No aroma or lookalike image assigned. |
| `045850b2-9e1f-11ee-b408-d069cd63062f` | `AROMAgroup Салями картридж 100`; representative aroma catalog | Scent confirmed, exact 100 ml package and reuse rights unconfirmed. Scent collage is not a product photo. |
| `CAPP-XMTFU` | Exact article and XMAS hat-box queries; [Neos Christmas catalog](https://www.neos1911.com/navigate-by-brand/teatro-fragranze-uniche/christmas.html) | XMAS diffuser and ORO hat giftbox do not establish XMAS set composition. Removed previously asserted 250 + 250 composition and scent claims; still hidden. |
| `0189` | Exact article + ножницы для фитиля | No reliable exact identity/brand/photo found. Generic scissors images rejected. |
| `132689` | `AROMAgroup "Благородная кожа" картридж 100`; representative catalog | No exact named product/photo match; keep fallback and hidden. |

The five unknown-brand SKU remain `445445`, `1113`, `121211`, `N020486`, `0189`. Search non-results are not proof that a product does not exist.

TEATRO accessory searches (`BAST500NTFU`, brand + sticks + 36/500) did not independently bind package quantity/diameter for the four source SKU. Existing source-supported wording is retained; no new dimensions or box-to-stick conversion. Supplier or label confirmation remains necessary.

## Landing-page content provenance

The 12 brand pages and 10 category pages describe only the pictured, positive-stock inventory. Names, formats and collection examples come from existing staged presentation and this review, not invented brand histories. Specific DANHERA notes already have exact-article evidence in the demand research; CULTI variants and Millefiori format are linked above. No external claims about founding dates, manufacturing quality, sales, reviews or brand prestige were added.

Discovery and cross-links are generated from available products, including the existing demand order. Unknown or empty slugs return 404. WoodWick has no discovery tile while its only stock item remains image/identity-blocked. Metadata uses relative canonicals resolved through the existing `NEXT_PUBLIC_SITE_URL`; a production domain and removal of global noindex/robots blocking require launch approval.
