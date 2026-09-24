# VOZDOOH catalog quality after merchandising — 24 September 2026

Scope: 148 positive-stock SKU / 220 units. Follow-up to the merchandising review,
starting from `218f8ba2`. Staged source is read-only. The demand JSON/CSV and TOP-25
remain unchanged. Resolved findings are separated below; unresolved issues have
not been removed. Full sources, access limitations and per-SKU searches:
[catalog cleanup evidence](catalog-cleanup-evidence-2026-09.md).

## RESOLVED

| Original finding | Resolution and evidence |
|---|---|
| Five generic VINOVE titles | `N020445` Rome / Evolution Excellence, `N020438` Indianapolis / Leather Espresso, `N020434` Monza / Leather Ivory, `N020325` London / Jewelry, `0b044a39-8588-11ed-b530-7c8bca00854e` Rome / Leather Espresso. All facts already occur in their exact source names. Presentation binding fixes slash truncation; no invented translation. |
| CULTI `65576` spelling | Display title is Automobili Lamborghini, supported by [official 1000 ml product](https://www.culti.com/en/diffusore-1000-ml-automobili-lamborghini.html). Source typo remains untouched. Physical finish/limited edition question remains below. |
| Aramara 250 ml apparent duplicate | [Decor](https://www.culti.com/en/diffusore-decor-aramara-250ml.html) and [Stile](https://www.culti.com/it/diffusore-stile-aramara-250ml.html) are separate collections. `802e8ae5-d19b-11ec-be83-7c8bca00854e` and `df29d344-d192-11ec-be83-7c8bca00854e` retain separate names, slugs, images and stock. Regression covered. |
| 24 of 27 AROMAgroup template descriptions | Exact fragrance sections in the [representative catalog](https://aroma-group.by/aromaty/) confirm brief note summaries. All 24 bindings are listed in the evidence supplement. Model compatibility is explicitly not promised. The remaining three are below. |
| Refill and stick category errors | Source-name precedence now detects refills and accessory boxes before the word “диффузор”. Gift sets stay sets. Matches the research product-type distinction. No quantity conversion. |
| `BD500TFU` format evidence | [Official Bianco Divino 500 ml with sticks](https://teatrofragranzeuniche.it/eu/bianco-divino-ml-500-with-sticks) and [exact retailer article](https://www.de-light.ru/catalog/teatro/diffuzor-bd500tfu-bianco_divino/) confirm diffuser, not linen spray. Indexed source text; direct opens failed. No production-year/collection claim added. |
| `22fimr` broad format category | [Official Mimosa Flower](https://millefiorimilano.com/en/products/selected-water-soluble-fragrance-mimosa-flower) confirms water-soluble 15 ml for Hydro ultrasonic diffusers. Now in “Водорастворимые ароматы”; demand rank unchanged. |
| `N020465` review-scope handling | [Sandalwood review source](https://lothantique.ca/products/lothantique-200ml-diffuser-refill-sandalwood) is a refill, not this diffuser. No ratings/reviews transferred; regression locks this boundary. Historical research caveat remains valid. |
| `V63011` review-scope handling | The existing research's Allegro reviews are for wax, not this 90 g candle. No review block, score or claim added; regression covers the boundary. Historical caveat remains valid. |
| Missing volume on non-liquid formats | No fabricated ml. Product details omit the inapplicable empty volume row; accessory subtitles no longer present destination-bottle volume as their own liquid volume. Original source name remains in details. |
| Unsupported XMAS composition in existing editorial | Removed the previously asserted 250 ml + 250 ml composition and aroma claims. Neutral description now explicitly requires composition confirmation. Actual composition remains unresolved below. |
| Unsupported N020486 dimensions in existing editorial | Removed the unverified 23 × 3 mm and pack-count assertion from the editorial description. Original source wording remains traceable in details. Identity/specification remains unresolved below. |

## UNRESOLVED — exact images (12 SKU)

All 12 remain excluded from normal product grids and discovery. No lookalike was
substituted. Internal `?debugCatalog=1` remains available. Existing product URLs
can still be opened directly; this review has not introduced a new access policy.

| SKU | Item | Remaining evidence needed |
|---|---|---|
| `98049E` | WoodWick small candle, source says Spiced Blackberry 85 g | Physical label: official article says Coastal Sunset. Identity conflict prevents photo/description assignment. |
| `9a227639-b1a0-11ed-a1a3-7c8bca00854e` | AG service liquid 110 ml | Exact packaging/model association and reusable product photograph. |
| `445445` | microUSB adapter, source 1.2 m | Manufacturer/article label, electrical ratings, compatibility and exact photo. |
| `4356` | AG service liquid 150 ml | Exact 150 ml packaging and photo; 110 ml image cannot be transferred. |
| `1113` | Rattan sticks, 1000 ml designation | Brand, physical dimensions/count and exact photo. |
| `121211` | Rattan sticks, 500 ml designation | Brand, physical dimensions/count and exact photo. |
| `N020486` | Light rattan sticks | Brand/label, correct dimensions/unit and pack count; exact photo. |
| `344565` | Ladenac Lui&Lei black gold room spray | Label identifying fragrance, size and generation. Jet Lag Black Gold is only a candidate. |
| `045850b2-9e1f-11ee-b408-d069cd63062f` | AG Salami cartridge 100 ml | Aroma now documented; exact cartridge package/model and photo rights are not. |
| `CAPP-XMTFU` | TEATRO XMAS hat-box set | Complete label/contents and photograph of this exact seasonal set. |
| `0189` | Wick scissors | Manufacturer/article and exact photograph. |
| `132689` | AG Noble Leather cartridge 100 ml | Exact aroma identity, package/model and photograph. |

Image provenance/reuse permission was not established for a new asset in this
pass. Supplier-provided or owner-shot exact product photographs remain needed.

## UNRESOLVED — unknown brands (5 SKU)

`445445`, `1113`, `121211`, `N020486`, `0189` remain unbranded. Similar accessories,
matching piece counts or cable lengths do not identify a manufacturer. Search
candidates and rejected matches are recorded in the evidence supplement.

## UNRESOLVED — descriptions and compatibility

- **WoodWick `98049E`:** no fragrance description until source/physical identity is
  reconciled. [Official article](https://www.yankeecandle.co.uk/woodwick/candles/shop-by-type/mini-jars/coastal-sunset-candle/SAP_98049E_PR.html) conflicts with the source name.
- **Three remaining AROMAgroup fallback descriptions:** service liquids
  `9a227639-b1a0-11ed-a1a3-7c8bca00854e`, `4356`, and Noble Leather `132689`.
  No invented pyramid or model compatibility. This accounts for the original
  27 together with the 24 resolved bindings in the evidence supplement.
- **`32131` AG Bordeaux 110 ml:** scent notes now supported, but connector and
  apparatus model are still unknown. No universal compatibility; confirmation
  required for this and the other cartridges before a transaction.

## UNRESOLVED — physical variants, sets and accessories

- **CULTI `65576`:** limited-edition attribution and actual bottle finish must be
  checked against the physical item. Spelling resolution does not resolve this.
- **Ladenac `344565`:** no verified binding from the internal article to a fragrance.
  No pyramid or variant photo added despite a plausible retailer candidate.
- **TEATRO `CAPP-XMTFU`:** source set composition is truncated. A separate XMAS
  diffuser and an ORO hat-box set do not prove its contents.
- **TEATRO sticks:** `08d97776-bb50-11ef-b425-ed110731e4f3`, `BAST500NTFU`,
  `63a36c45-bb50-11ef-b425-ed110731e4f3`, `83763644-bb50-11ef-b425-ed110731e4f3`;
  and rattan `N020486`: length, diameter and actual pack count need supplier/label
  verification. Source descriptions are not external proof. Stock is still boxes,
  not recalculated into loose sticks. Not promoted as fragrance bestsellers.
- **`445445`:** manufacturer, output ratings and compatibility are unknown. No
  bundle assignment or technical recommendation.
- **Non-ml formats:** sachets, VINOVE car items and AROMAgroup apparatus have no
  invented liquid volume. The existing Mareminerale 7 × 7 cm description is retained.

## CORE/STRONG completion and launch review

No newly blocked CORE/STRONG card. The original 14 completed/sufficient cards
remain so, and TOP-25 is regression-checked unchanged. Physical comparison of
photos and labels for all 14 remains necessary before promotion; Aramara 250 ml
Decor and Stile must remain separately selectable.

Sergey/supplier decisions still needed: resolve the physical identities and
specifications above; supply/authorize exact imagery; confirm cartridge models;
and approve production domain/indexing and any future commerce launch. Checkout,
payments and order submission remain disabled. No procurement recommendation.

Implementation and environment verification are recorded separately in
[catalog cleanup QA](catalog-cleanup-qa-2026-09.md).
