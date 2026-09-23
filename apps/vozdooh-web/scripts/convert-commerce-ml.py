#!/usr/bin/env python3
import argparse
import json
import re
from pathlib import Path
import xml.etree.ElementTree as ET

SKU_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")
DEFAULT_WAREHOUSE_ID = "8821bc1b-74de-11e8-ab27-d8cb8ae95d97"
DEFAULT_PRICE_TYPE_ID = "f9bf1e9b-a9b8-11e9-bd03-7c8bca00854e"

def local(tag):
    return tag.split("}")[-1]

def child_text(node, name):
    for child in node:
        if local(child.tag) == name:
            return (child.text or "").strip()
    return ""

def latest_staged(root, pattern):
    matches = []
    for candidate in root.rglob(pattern):
        manifest = candidate.parent / "imports.jsonl"
        if not manifest.exists():
            continue
        try:
            records = [json.loads(line) for line in manifest.read_text().splitlines() if line.strip()]
        except (OSError, json.JSONDecodeError):
            continue
        if any(record.get("filename") == candidate.name and record.get("state") == "staged" for record in records):
            matches.append(candidate)
    if not matches:
        raise SystemExit(f"Missing staged {pattern} under {root}")
    return max(matches, key=lambda item: item.stat().st_mtime)
def parse_args():
    ap = argparse.ArgumentParser(description="Convert staged CommerceML into VOZDOOH preview snapshot")
    ap.add_argument("--exchange-root", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--report", required=True)
    ap.add_argument("--warehouse-id", default=DEFAULT_WAREHOUSE_ID)
    ap.add_argument("--price-type-id", default=DEFAULT_PRICE_TYPE_ID)
    ap.add_argument("--publish-price", action="store_true")
    return ap.parse_args()

def build_group_names(root):
    names = {}
    for node in root.iter():
        if local(node.tag) != "Группа":
            continue
        gid = child_text(node, "Ид")
        name = child_text(node, "Наименование")
        if gid and name:
            names[gid] = name
    return names

def product_group(node, group_names):
    groups = next((c for c in node if local(c.tag) == "Группы"), None)
    if groups is None:
        return "Без категории"
    for item in groups:
        if local(item.tag) == "Ид":
            gid = (item.text or "").strip()
            if gid:
                return group_names.get(gid, "Без категории")
    return "Без категории"
def parse_products(import_path):
    root = ET.parse(import_path).getroot()
    group_names = build_group_names(root)
    rows = []
    for node in root.iter():
        if local(node.tag) != "Товар":
            continue
        source_id = child_text(node, "Ид")
        name = child_text(node, "Наименование")
        if not source_id or not name:
            continue
        rows.append({
            "source_id": source_id,
            "article": child_text(node, "Артикул"),
            "name": CONTROL_RE.sub(" ", name)[:500].strip(),
            "barcode": child_text(node, "Штрихкод") or None,
            "category": CONTROL_RE.sub(" ", product_group(node, group_names))[:500].strip(),
        })
    return rows

def parse_offers(offers_path, warehouse_id, price_type_id):
    root = ET.parse(offers_path).getroot()
    offers = {}
    for node in root.iter():
        if local(node.tag) != "Предложение":
            continue
        source_id = child_text(node, "Ид")
        if not source_id:
            continue
        stock = 0.0
        price = None
        for child in node:
            tag = local(child.tag)
            if tag == "Склад" and child.attrib.get("ИдСклада") == warehouse_id:
                raw = child.attrib.get("КоличествоНаСкладе", "0")
                try:
                    stock = float(raw)
                except ValueError:
                    stock = 0.0
            elif tag == "Цены":
                for price_node in child:
                    if local(price_node.tag) != "Цена":
                        continue
                    if child_text(price_node, "ИдТипаЦены") != price_type_id:
                        continue
                    raw = child_text(price_node, "ЦенаЗаЕдиницу")
                    try:
                        price = float(raw)
                    except ValueError:
                        price = None
        offers[source_id] = {"stock": stock, "price": price}
    return offers

def choose_skus(rows):
    counts = {}
    for row in rows:
        article = row["article"]
        if article and SKU_RE.fullmatch(article):
            counts[article] = counts.get(article, 0) + 1
    fallback = 0
    for row in rows:
        article = row["article"]
        if article and SKU_RE.fullmatch(article) and counts.get(article) == 1:
            row["sku"] = article
        else:
            row["sku"] = row["source_id"]
            fallback += 1
    return fallback
def atomic_write(path, text):
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(text)
    temporary.replace(path)

def main():
    args = parse_args()
    exchange_root = Path(args.exchange_root)
    import_path = latest_staged(exchange_root, "import*.xml")
    offers_path = latest_staged(exchange_root, "offers*.xml")

    rows = parse_products(import_path)
    offers = parse_offers(offers_path, args.warehouse_id, args.price_type_id)
    fallback_skus = choose_skus(rows)

    products = []
    matched_offers = 0
    positive_stock = 0
    negative_target_stock_products = 0
    nonzero_selected_prices = 0
    for row in rows:
        offer = offers.get(row["source_id"])
        stock = offer["stock"] if offer else 0.0
        if stock < 0:
            negative_target_stock_products += 1
            stock = 0.0
        selected_price = offer["price"] if offer else None
        if offer:
            matched_offers += 1
        if stock > 0:
            positive_stock += 1
        if selected_price is not None and selected_price > 0:
            nonzero_selected_prices += 1
        price = selected_price if args.publish_price else None
        products.append({
            "sku": row["sku"],
            "name": row["name"],
            "brand": None,
            "category": row["category"],
            "volume": None,
            "price": price,
            "stock": stock,
            "barcode": row["barcode"],
            "characteristics": {},
        })

    snapshot = {"kind": "staged-real-1c", "version": 1, "products": products}
    report = {
        "import_file": import_path.name,
        "offers_file": offers_path.name,
        "products": len(products),
        "matched_offers": matched_offers,
        "positive_target_stock_products": positive_stock,
        "negative_target_stock_clamped_to_zero": negative_target_stock_products,
        "nonzero_selected_price_products": nonzero_selected_prices,
        "prices_published": bool(args.publish_price),
        "fallback_skus": fallback_skus,
        "warehouse_id": args.warehouse_id,
        "price_type_id": args.price_type_id,
    }

    output = Path(args.output)
    report_path = Path(args.report)
    output.parent.mkdir(parents=True, exist_ok=True)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    atomic_write(output, json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n")
    atomic_write(report_path, json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False))
if __name__ == "__main__":
    main()
