#!/usr/bin/env python3
"""Planning-only audit. NEVER authorizes shipping prices or verified packing."""
import argparse
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

def coverage(products, records, cartons, clearance_mm=20):
    verified = {row['sku']: row['shipping'] for row in records if row.get('status') == 'VERIFIED'}
    rows = []
    for product in products:
        stock = product.get('stock') or 0
        price = product.get('price') or 0
        if stock <= 0 or price <= 0:
            continue
        sku = product['sku']
        shipping = verified.get(sku)
        match = None
        if shipping and all(isinstance(shipping.get(k), int) and shipping[k] > 0 for k in ('lengthMm', 'widthMm', 'heightMm', 'weightG')):
            dimensions = sorted((shipping['lengthMm'], shipping['widthMm'], shipping['heightMm']), reverse=True)
            for carton in cartons:
                inner = sorted((carton['innerLengthMm'], carton['innerWidthMm'], carton['innerHeightMm']), reverse=True)
                if all(size + clearance_mm <= space for size, space in zip(dimensions, inner)):
                    match = carton['id']
                    break
            status = 'ESTIMATED_FIT' if match else 'NEEDS_LARGER_BOX'
        else:
            status = 'MISSING_VERIFIED_PRODUCT_DIMENSIONS'
        rows.append({'sku': sku, 'name': product['name'], 'stock': stock, 'price_rub': price, 'status': status,
                     'reference_box': match or '', 'product_weight_g': shipping['weightG'] if shipping and shipping.get('weightG') else ''})
    return rows

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--catalog', required=True, type=Path)
    parser.add_argument('--out', default=ROOT / 'research/reports/carton-coverage-20261013.csv', type=Path)
    args = parser.parse_args()
    products = json.loads(args.catalog.read_text())['products']
    records = json.loads((ROOT / 'research/data/logistics-dataset-real.json').read_text())['records']
    cartons = json.loads((ROOT / 'research/data/estimated-cartons-market.json').read_text())['cartons']
    rows = coverage(products, records, cartons)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open('w', newline='', encoding='utf-8-sig') as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    from collections import Counter
    print('Sellable products:', len(rows))
    print('Statuses:', dict(Counter(r['status'] for r in rows)))
    print('Reference cartons:', dict(Counter(r['reference_box'] for r in rows if r['reference_box'])))
    print('Wrote:', args.out)

if __name__ == '__main__':
    main()
