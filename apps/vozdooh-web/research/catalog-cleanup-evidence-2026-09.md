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

## Exact-identity recheck — 27 September 2026

Rechecked all 12 image blockers and all five unknown brands. Manufacturer pages
were checked first where a manufacturer is known; unbranded internal articles
cannot select an authoritative manufacturer by themselves. Exact-article searches
and the earlier retailer candidates were used only to seek corroboration. No
image, brand, fragrance, specification or SKU mapping was added. Search misses
are not evidence of absence. Direct-open failures below mean the browser tool
could not retrieve the page, not that the product has been discontinued.

### New evidence and limitations

- [Official Ladenac Home Fragrance Jet Lag 200ml](https://www.ladenac.com/en/home-fragrance-jet-lag-200ml), opened: the current page describes black/silver styling and reed-diffuser packaging despite the Home Fragrance title. It does not bind internal `344565` or establish the older black/gold spray. This makes transfer of the current photo or format particularly unsafe; no new scent copy is justified.
- [Official TEATRO Xmas diffuser](https://teatrofragranzeuniche.it/it/xmas-diffusore-con-bastoncini), opened: identifies a separate reed diffuser. Neither this page nor exact `CAPP-XMTFU` searches establish the hat-box contents or photograph. A fragrance page cannot establish a seasonal set's composition.
- [Megadez price list](https://megadez.pro/price-list/), opened: separately lists AG cleaning liquid 110 ml and a cleaning cartridge 150 ml. This adds corroboration for the existence of the 150 ml format beyond the previous 110 ml candidate. Neither row supplies our article, a label, a package photo or reuse authorization; it does not resolve either service-liquid SKU. No retailer price is transferred.
- [Manufacturer SPA 200 instructions](https://aroma-group.ru/upload/iblock/785/ozxdjwspa685gqaf87txkuk4e4p0fzj2/Instruktsiya-dlya-apparata-SPA-200.pdf) surfaced in search with cleaning instructions; direct open failed. The manufacturer homepage also failed to open. Indexed operating instructions do not identify these stock cartridges, and no compatibility was inferred.
- [AROMAgroup representative fragrance catalog](https://aroma-group.by/aromaty/), opened: Salami remains a fragrance-level entry, not a labeled 100 ml cartridge. A text search did not find Noble Leather. A [third-party presentation mirror](https://ppt-online.org/435794) surfaced Noble Leather, but its provenance/version and exact SKU binding are unverified; rejected as a basis for customer copy. No notes were copied.

### Per-SKU disposition

| SKU | Recheck and exact remaining blocker |
|---|---|
| `98049E` | [Official WoodWick page](https://www.yankeecandle.co.uk/woodwick/candles/shop-by-type/mini-jars/coastal-sunset-candle/SAP_98049E_PR.html) opened again: Coastal Sunset, 85 g, article 98049E. Still conflicts with source Spiced Blackberry. Physical label required before choosing either image or scent. |
| `9a227639-b1a0-11ed-a1a3-7c8bca00854e` | Manufacturer service documentation sought first; Megadez list corroborates 110 ml only at format level. Exact package/model/label and authorized image remain missing. Earlier Megadez product-page open failed. |
| `4356` | Manufacturer documentation then Megadez list checked. New 150 ml format corroboration does not bind internal 4356 to a package/model or exact photograph. Remains blocked; no transfer from 110 ml. |
| `445445` | Exact `445445 microUSB`, `445445 адаптер` and manufacturer-domain `site:rexant.ru 445445` searches yielded no usable exact match. The prior Rexant candidate is still not an article match. Brand, ratings, compatibility and image require the physical label. |
| `1113` | Exact article with палочки/ротанговые/1000 searches returned no usable manufacturer identity. The bottle designation does not establish brand, dimensions, count or image. |
| `121211` | Exact article with палочки/ротанговые searches returned no usable identity. Remains distinct from 1113; brand, dimensions, count and photograph require label evidence. |
| `N020486` | Exact article, палочки and `site:lothantique.com N020486` searches yielded no relevant manufacturer binding. Earlier Milfey candidate could not be opened. Neither count nor an unrelated article-number collision establishes brand, dimensions or photo. |
| `344565` | Official Ladenac page above and exact internal-article search do not bind the black/gold spray. Current styling/format text cannot resolve the older physical variant; label showing fragrance, volume and generation required. |
| `045850b2-9e1f-11ee-b408-d069cd63062f` | Manufacturer-domain Salami search, then representative catalog and `AROMAgroup Салями 100` search: only fragrance-level support. Exact cartridge package/model and authorized image remain missing. |
| `CAPP-XMTFU` | Official Xmas page and exact article/hat-box searches do not establish this set. Full contents label and exact set photograph still required. |
| `0189` | Exact article with ножницы для фитиля and wick searches yielded no usable manufacturer binding. Generic wick scissors cannot establish brand or exact image. |
| `132689` | Manufacturer-domain Noble Leather search, representative catalog and exact article search do not identify the 100 ml package. Unverified presentation mirror above is insufficient; exact label/model/photo and authoritative fragrance binding remain needed. |

Unknown brands remain exactly `445445`, `1113`, `121211`, `N020486`, `0189`.
No product/category/brand copy expansion meets the exact-evidence threshold in
this pass. Existing supported descriptions remain unchanged.

### Customer copy and preview state

The collections page no longer implies that real catalog items have yet to
arrive, and its link now leads visitors to the catalog rather than its
“structure”. Finder metadata describes its existing characteristic filters
without universally calling the catalog a demo. Actual demo-mode labels remain.
No homepage layout, demand order, catalog facts or private-preview controls change.

The current preview domain is `vozdooh27.ru` (owner-provided context; no domain or
infrastructure setting changed). The implemented staged-1c flow accepts local
requests for manual handling; see [request contract](../src/integrations/order-requests.md).
This is not a production launch, payment, reservation or 1C writeback.

### Verification of this pass

`VOZDOOH_ISOLATED_BUILD=true npm run verify` passed: `npm test` (47 app tests,
2 exchange tests, 9 Python tests), `npm run typecheck`, `npm run lint`, and the
isolated `npm run build`. The first sandboxed run lost CLI subprocess output;
the full rerun outside the sandbox passed without code/test changes. Generated
`next-env.d.ts` was restored. The isolated collections HTML contains the updated
copy and noindex/nofollow. `git diff --check` passed. No live `.next` build or
preview replacement was performed; synthetic tests did not use existing local
order records. The reviewed diff contains only the two copy files and two
research documents.

## 2026-09-27 — barcode resolution pass for previously hidden positive-stock SKUs

- 98049E: staged barcode 5038581056647 repeatedly resolves to WoodWick Spiced Blackberry Mini 85 g.
  A separate product record identifies manufacturer code 98078E, explaining why the staged SKU itself
  conflicts with the current 98049E manufacturer mapping. The 1C SKU stays untouched; storefront identity
  is bound by the staged barcode. The local image comes from a product page carrying the same EAN and 85 g variant.
- 1113: staged barcode/manufacturer article 8055965595063 resolves to CULTI MILANO rattan reeds for
  1000 ml diffusers, length 43 cm. Brand and description are now safe to enrich, but the SKU remains
  hidden until an exact clean local image is obtained.
- N020486: staged barcode 3420070023704 resolves to Lothantique natural rattan sticks, 18 pieces,
  23 × 3 mm. Lothantique also lists the exact 23 cm / 3 mm natural-rattan accessory. Brand and description
  are resolved; the SKU remains hidden until its exact image can be copied locally without a substitute.
- 121211: no reliable match was found for staged barcode 8050534799088; do not infer the brand from the
  neighbouring 1000 ml item.
- Other hidden items remain blocked when the exact variant or exact image is not verified.

## 2026-09-27 — exact-image verification follow-up

- 1113: barcode 8055965595063 is confirmed by TSUM and other retailers as CULTI MILANO rattan reeds for 1000 ml diffusers, 43 cm. The local storefront image was copied from the TSUM product page that exposes the same manufacturer article/barcode and depicts the branded CULTI pack. This SKU can now return to the customer storefront.
- N020486: barcode 3420070023704 and Lothantique reference LORB23 are confirmed as 18 natural rattan sticks, 23 cm × 3 mm. The local storefront image was copied from the iFantazie product card for exact reference LORB23; the package is visibly branded Lothantique. This SKU can now return to the customer storefront.
- 121211: current public CULTI 500 ml reeds use manufacturer article 8055965595056, which does not match staged barcode 8050534799088. Do not reuse the 500 ml CULTI image or infer brand until the physical label or a source for the staged barcode is found.
- 445445: barcode 4610024333280 resolves to an AceLine H5B1A black wall charger. It is a legacy non-fragrance item and is explicitly excluded from the normal VOZDOOH storefront even if a product image becomes available. 1C trade data remains untouched.

Image evidence used for this pass:
- TSUM product page: https://www.tsum.ru/product/he00476456-rotangovye-palochki-dlya-diffuzora-1000ml-culti-milano-bestcvetnyi/
- iFantazie exact LORB23 card: https://www.ifantazie.cz/nahradni-drivka-do-difuzeru-bal-18-ks--23-cm-x-3-mm--prirodni/

## 2026-09-27 — AROMAgroup exact-product recovery

- `9a227639-b1a0-11ed-a1a3-7c8bca00854e`: staged 1C identifies AROMAgroup cleaning fluid, 110 ml. MegaDez has an exact product page titled `АG Жидкость для промывки, 110 мл`; the page uses the same AROMAgroup service-fluid product image now stored locally. 1C price/stock remain authoritative.
- `4356`: staged 1C identifies AROMAgroup cleaning fluid, 150 ml. MegaDez has an exact `AG Картридж с жидкостью для промывки, 150 мл` listing and uses the same service-fluid image. The image is intentionally shared because the source itself uses the same pack shot for both exact volume pages.
- `132689`: staged 1C identifies `Благородная кожа картридж AG 100 мл`. CleanBK has an exact product card with the same AROMAgroup product name and 100 ml format; its product-page image is stored locally. No external price or stock was copied.

Evidence:
- https://megadez.pro/produktsiya/aromatizatsiya/ag-zhidkost-dlya-promyvki-110-ml/
- https://megadez.pro/produktsiya/aromatizatsiya/ag-kartridzh-s-zhidkostyu-dlya-promyvki-150-ml/
- https://cleanbk.ru/item/0006413-blagorodnaya_koja_kartridj_ag_100ml_plast

## 2026-09-27 — TEATRO XMAS hat-box recovery

- `CAPP-XMTFU`: staged 1C identifies a TEATRO XMAS/Christmas hat-box gift set containing a 250 ml reed diffuser and a 250 ml refill. A Profumix Luxury Brands product page independently identifies the same TEATRO `CAPPELLIERA - ORO - STICK 250ML + REFILL 250ML` set, and its product photograph visibly shows the red `Christmas in Florence` hat box, TEATRO Oro diffuser, refill and reeds. This resolves the former composition/photo uncertainty without copying external price or stock.
- Local storefront image: `/catalog/official/CAPP-XMTFU.jpg` from the exact Profumix product page.

Evidence:
- https://profumixluxurybrands.it/en/brands/teatro-fragranze-uniche-cappelliera-oro-stick-250ml-refill-250ml/

## 2026-09-27 — Ladenac Lui&Lei Jet Lag Black Gold recovery

- SKU 344565: staged 1C name is Ladenac room spray Lui&Lei black gold, barcode 8411299003023, stock 1.
- The TSUM product page is an exact match for Спрей для дома Jet lag Black gold (125ml) Ladenac Milano; its page source also contains staged barcode 8411299003023. The exact product photograph is now stored locally as /catalog/official/344565.jpg.
- LeMa Aroma's public catalog independently lists JET LAG BLACK GOLD спрей 125мл. Lui&Lei LADENAC.
- KOKU's exact 125 ml Jet Lag room-spray page describes the older black/gold presentation and cedar/tobacco scent. This is used only for the product description, not for price or stock.
- Current Ladenac pages show the later redesigned 200 ml Lui&Lei line; those current 200 ml details are not applied to this archived 125 ml SKU.

Evidence:
- https://www.tsum.ru/product/he00855745-sprei-dlya-doma-jet-lag-black-gold-125ml-ladenac-milano-bestcvetnyi/
- https://lemaaroma.com/karta-sajta/
- https://www.koku.pl/ladenac-lui-lei-jet-lag-spray-domowy-125ml-w-opakowaniu-prezentowym
