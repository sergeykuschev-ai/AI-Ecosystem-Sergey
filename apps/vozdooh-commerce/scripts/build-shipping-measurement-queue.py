#!/usr/bin/env python3
"""Prioritize measurement of missing sellable product dimensions; no inferred measurements."""
import argparse
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIELDS = ['priority','sku','barcode','name','brand','stock','price_rub','stock_value_rub','missing_fields','weight_g_measured','length_mm_measured','width_mm_measured','height_mm_measured','measured_by','measured_at','notes']

def build(catalog, logistics):
    logistics_by_sku = {r['sku']: r for r in logistics['records']}
    rows = []
    for p in catalog['products']:
        stock = p.get('stock') or 0
        price = p.get('price') or 0
        if stock <= 0 or price <= 0:
            continue
        record = logistics_by_sku.get(p['sku'])
        if record and record.get('status') == 'VERIFIED' and all(isinstance(record['shipping'].get(k), int) and record['shipping'][k] > 0 for k in ('weightG','lengthMm','widthMm','heightMm')):
            continue
        shipping = record.get('shipping', {}) if record else {}
        missing = [k for k in ('weightG','lengthMm','widthMm','heightMm') if not isinstance(shipping.get(k), int) or shipping[k] <= 0]
        rows.append({'priority': '', 'sku': p['sku'], 'barcode': p.get('barcode') or '', 'name': p['name'], 'brand': p.get('brand') or '',
                     'stock': stock, 'price_rub': price, 'stock_value_rub': round(stock * price, 2), 'missing_fields': ','.join(missing),
                     'weight_g_measured': '', 'length_mm_measured': '', 'width_mm_measured': '', 'height_mm_measured': '',
                     'measured_by': '', 'measured_at': '', 'notes': 'Record whole retail unit including retail packaging; never use net liquid volume as weight.'})
    rows.sort(key=lambda r: (-r['stock_value_rub'], r['sku']))
    for i, row in enumerate(rows, 1): row['priority'] = i
    return rows

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--catalog', type=Path, required=True)
    p.add_argument('--out', type=Path, default=ROOT / 'research/reports/shipping-measurement-queue.csv')
    a = p.parse_args()
    rows = build(json.loads(a.catalog.read_text()), json.loads((ROOT / 'research/data/logistics-dataset-real.json').read_text()))
    a.out.parent.mkdir(parents=True, exist_ok=True)
    with a.out.open('w', newline='', encoding='utf-8-sig') as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    print('Missing product measurements:', len(rows))
    print('Total at-risk sellable inventory value (RUB):', round(sum(r['stock_value_rub'] for r in rows), 2))
    print('Top five:', [(r['sku'], r['stock_value_rub']) for r in rows[:5]])
    print('Output:', a.out)

if __name__ == '__main__': main()
