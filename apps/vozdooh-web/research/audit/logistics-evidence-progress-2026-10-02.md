# VOZDOOH — logistics evidence progress, 2 October 2026

This file records public-source measurements for exact current-stock SKUs. It deliberately separates **product / retail-package facts** from the final **VOZDOOH shipping parcel** required by Ozon Delivery.

## Progress

- Eligible current positive-stock SKUs: 148.
- Researched exact-SKU records in this evidence batch: 148 of 148.
- Explicit full retail-package evidence: 8.
- Full product-measurement evidence (not retail package): 33.
- Partial evidence: 80.
- Conflicts preserved for manual resolution: 12.
- NEEDS_SOURCE after the current public-source pass: 15.
- Delivery-input ready records under the owner-approved rule (verified product dimensions + weight are sufficient): **44**. Outer VOZDOOH box / protection / filler is not required for dataset readiness.

## Safety rule

Do not convert ml to grams. Do not invent a missing third dimension. Do not copy dimensions from a similar fragrance/format to another EAN unless a source explicitly establishes shared packaging. Verified exact-SKU product dimensions and weight are accepted as delivery input by owner decision. Volume is still never converted to weight and missing dimensions are never invented. Product-vs-product or identity conflicts remain blocked; a separate package-only conflict does not block an independently verified exact-SKU product measurement.

## Strongest current evidence

VINOVE Maranello, Miami and Silverstone refills have explicit exact-EAN retail-package measurements of 140 × 70 × 10 mm and 13 g. Culti Decor Mediterranea 250 ml (EAN 8050534794489) has an explicit package record of 90 × 90 × 170 mm and 704 g. Vellutier Into the Wilderness 515 g has an explicit package record of 153 × 145 × 207 mm and 1480 g; Vellutier Midnight Toast 225 g has 164 × 103 × 175 mm and 680 g. Castelbel Cotton Flower sachet has exact-EAN package data of 100 × 4 × 187 mm and 20 g.

Exact products with verified full product dimensions and total weight can be used as delivery input under the owner-approved rule even when retail-package dimensions are unavailable. Partial measurements, volume-only records and conflicting exact sources remain blocked instead of being guessed.

## Next research queue

All 148 current positive-stock SKUs have now been triaged against public sources. Continue deeper exact-SKU research on the 18 NEEDS_SOURCE records and resolve the 12 identity/measurement conflicts; also upgrade PARTIAL records where a full weight or missing dimension can be verified. Under the owner-approved rule, a SKU may enter the delivery-input dataset once it has verified full dimensions and weight with no unresolved identity conflict.
