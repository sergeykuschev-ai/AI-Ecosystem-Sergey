#!/usr/bin/env python3
"""Read-only audit of paid VOZDOOH orders against the newest imported 1C stock.

This is a *warning heuristic*, NOT an inventory reservation or 1C reconciliation.
No customer contact details or order IDs are printed or modified.
"""
import argparse
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

def audit(orders_dir: Path, catalog_path: Path) -> dict:
    catalog=json.loads(catalog_path.read_text(encoding='utf-8'))
    products={x['sku']:x for x in catalog['products']}
    paid_count=0
    paid_lines=0
    warnings=[]
    for order_file in sorted(orders_dir.glob('*.json')):
        if order_file.is_symlink():
            continue
        data=json.loads(order_file.read_text(encoding='utf-8'))
        if not isinstance(data,dict) or (data.get('payment') or {}).get('status') != 'PAID':
            continue
        paid_count+=1
        for line in data.get('lines',[]):
            paid_lines+=1
            sku=line.get('sku')
            current=products.get(sku)
            initial=line.get('stockAtRequest')
            quantity=line.get('quantity')
            if current is None:
                warnings.append({'sku':sku,'reason':'not_in_latest_import'})
            elif isinstance(initial,(float,int)) and isinstance(quantity,(int,float)):
                now=current.get('stock')
                if isinstance(now,(float,int)) and now >= initial:
                    warnings.append({'sku':sku,'reason':'stock_not_lower_than_at_paid_request',
                                     'stock_at_request':initial,'stock_now':now,'ordered_quantity':quantity})
    return {
        'catalog_timestamp_utc': datetime.fromtimestamp(catalog_path.stat().st_mtime,tz=timezone.utc).isoformat(),
        'paid_orders':paid_count,
        'paid_lines':paid_lines,
        'possible_unreconciled_lines':len(warnings),
        'warnings':warnings,
        'note':'Warnings are nondefinitive: restock or manual 1C posting can explain unchanged balance. No writes performed.',
    }

def main() -> None:
    a=argparse.ArgumentParser()
    a.add_argument('--orders-dir',type=Path,default=Path('/opt/vozdooh/data/order-requests'))
    a.add_argument('--catalog',type=Path,default=Path('/opt/vozdooh/data/catalog-staged.json'))
    args=a.parse_args()
    print(json.dumps(audit(args.orders_dir,args.catalog),ensure_ascii=False,indent=2))

if __name__=='__main__': main()
