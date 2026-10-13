#!/usr/bin/env python3
"""Report evidence gaps for sellable SKUs; never promotes unverified dimensions."""
import argparse
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIELDS = ['priority','sku','name','stock_value_rub','evidence_status','review_category','known_weight_g','known_dimensions_mm','source_count','source_urls','review_action']

def analyze(queue, evidence):
    by_sku = {r['sku']: r for r in evidence['records']}
    rows = []
    for row in queue:
        item = by_sku.get(row['sku'], {})
        measurements = item.get('measurements', [])
        weights = sorted({m['weightG'] for m in measurements if isinstance(m.get('weightG'), int) and m['weightG'] > 0 and m.get('scope') not in ('wax_fill_only','research_gap')})
        dimensions = sorted({tuple(m['dimensionsMm']) for m in measurements if isinstance(m.get('dimensionsMm'), list) and all(isinstance(x,int) and x>0 for x in m['dimensionsMm'])})
        sources = sorted({m['sourceUrl'] for m in measurements if isinstance(m.get('sourceUrl'),str) and m['sourceUrl'].startswith('http')})
        status = item.get('status','NO_EVIDENCE')
        if status == 'CONFLICT' or len(weights)>1 or len(dimensions)>1:
            category = 'SOURCE_CONFLICT'; action = 'Check barcode, model, retail packaging, and physically weigh and measure.'
        elif dimensions and weights:
            category = 'REVIEW_COMPLETE_EVIDENCE'; action = 'Check exact SKU/EAN and whether weight and dimensions describe the same complete item; do not auto-approve.'
        elif dimensions:
            category = 'MISSING_WEIGHT'; action = 'Physically weigh the complete retail unit; verify dimension source matches exact SKU.'
        elif weights:
            category = 'MISSING_DIMENSIONS'; action = 'Physically measure complete retail unit and verify weight source.'
        else:
            category = 'PHYSICAL_MEASUREMENT_REQUIRED'; action = 'Measure all dimensions and total retail unit weight; do not infer from liquid volume.'
        rows.append({'priority': row['priority'], 'sku': row['sku'], 'name': row['name'], 'stock_value_rub': row['stock_value_rub'],
                     'evidence_status': status, 'review_category': category, 'known_weight_g': '|'.join(map(str,weights)),
                     'known_dimensions_mm': '|'.join('x'.join(map(str,d)) for d in dimensions), 'source_count': len(sources),
                     'source_urls': ' | '.join(sources), 'review_action': action})
    return rows

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--queue', type=Path, default=ROOT/'research/reports/shipping-measurement-queue.csv')
    p.add_argument('--out', type=Path, default=ROOT/'research/reports/logistics-evidence-gaps.csv')
    args=p.parse_args()
    with args.queue.open(encoding='utf-8-sig',newline='') as f: queue=list(csv.DictReader(f))
    evidence=json.loads((ROOT/'research/data/logistics-evidence-2026-10-02.json').read_text())
    rows=analyze(queue,evidence)
    args.out.parent.mkdir(parents=True,exist_ok=True)
    with args.out.open('w',encoding='utf-8-sig',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=FIELDS);writer.writeheader();writer.writerows(rows)
    from collections import Counter
    print('EVIDENCE_REVIEW:',dict(Counter(r['review_category'] for r in rows)))
    print('Saved:',args.out)
    for row in rows[:8]:print(row['priority'],row['sku'],row['review_category'],row['known_weight_g'],row['known_dimensions_mm'])

if __name__=='__main__':main()
