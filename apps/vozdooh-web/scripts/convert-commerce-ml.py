#!/usr/bin/env python3
import argparse
import json
import hashlib
import math
import os
import tempfile
import re
from pathlib import Path
import xml.etree.ElementTree as ET

SKU_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")
# Keep snapshot limits aligned with src/catalog/onec.ts and localStore.ts.
MAX_PRODUCTS = 10_000
MAX_SNAPSHOT_BYTES = 10 * 1024 * 1024
MAX_SAFE_NUMBER = 9_007_199_254_740_991
DEFAULT_WAREHOUSE_ID = "8821bc1b-74de-11e8-ab27-d8cb8ae95d97"
DEFAULT_PRICE_TYPE_ID = "f9bf1e9b-a9b8-11e9-bd03-7c8bca00854e"

def local(tag):
    return tag.split("}")[-1]

def child_text(node, name):
    for child in node:
        if local(child.tag) == name:
            return (child.text or "").strip()
    return ""

def staged_candidates(root, pattern):
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
    return matches

def formation_key(path):
    for _, root in ET.iterparse(path, events=("start",)):
        return root.attrib.get("ДатаФормирования", "")
    return ""

def latest_staged_pair(root):
    imports = staged_candidates(root, "import*.xml")
    offers = staged_candidates(root, "offers*.xml")
    if not imports or not offers:
        raise SystemExit(f"Missing staged CommerceML pair under {root}")
    imports_by_key = {}
    offers_by_key = {}
    for path in imports:
        imports_by_key.setdefault(formation_key(path), []).append(path)
    for path in offers:
        offers_by_key.setdefault(formation_key(path), []).append(path)
    common = [key for key in imports_by_key if key and key in offers_by_key]
    if not common:
        raise SystemExit("No fully staged import/offers pair with matching formation date")
    pairs = []
    for key in common:
        imp = max(imports_by_key[key], key=lambda item: item.stat().st_mtime)
        off = max(offers_by_key[key], key=lambda item: item.stat().st_mtime)
        pairs.append((max(imp.stat().st_mtime, off.stat().st_mtime), imp, off))
    _, imp, off = max(pairs, key=lambda item: item[0])
    return imp, off
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
    seen = set()
    for node in root.iter():
        if local(node.tag) != "Товар":
            continue
        source_id = child_text(node, "Ид")
        name = child_text(node, "Наименование")
        if not source_id or not name or source_id in seen:
            raise ValueError("INVALID_OR_DUPLICATE_PRODUCT_ID_OR_NAME")
        seen.add(source_id)
        rows.append({
            "source_id": source_id,
            "article": child_text(node, "Артикул"),
            "name": CONTROL_RE.sub(" ", name)[:500].strip(),
            "barcode": child_text(node, "Штрихкод") or None,
            "category": CONTROL_RE.sub(" ", product_group(node, group_names))[:500].strip(),
        })
    return rows

def finite_number(raw, code):
    try:
        value = float(raw)
    except (ValueError, TypeError):
        raise ValueError(code) from None
    if not math.isfinite(value) or abs(value) > MAX_SAFE_NUMBER:
        raise ValueError(code)
    return value

def parse_offers(offers_path, warehouse_id, price_type_id):
    root = ET.parse(offers_path).getroot()
    offers = {}
    for node in root.iter():
        if local(node.tag) != "Предложение":
            continue
        source_id = child_text(node, "Ид")
        if not source_id or source_id in offers:
            raise ValueError("INVALID_OR_DUPLICATE_OFFER_ID")
        stock = 0.0
        price = None
        warehouse_seen = False
        price_seen = False
        for child in node:
            tag = local(child.tag)
            if tag == "Склад" and child.attrib.get("ИдСклада") == warehouse_id:
                if warehouse_seen:
                    raise ValueError("DUPLICATE_SELECTED_WAREHOUSE")
                warehouse_seen = True
                stock = finite_number(child.attrib.get("КоличествоНаСкладе", ""), "INVALID_STOCK")
            elif tag == "Цены":
                for price_node in child:
                    if local(price_node.tag) != "Цена":
                        continue
                    if child_text(price_node, "ИдТипаЦены") != price_type_id:
                        continue
                    if price_seen:
                        raise ValueError("DUPLICATE_SELECTED_PRICE")
                    price_seen = True
                    price = finite_number(child_text(price_node, "ЦенаЗаЕдиницу"), "INVALID_PRICE")
                    if price < 0:
                        raise ValueError("INVALID_PRICE")
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
    skus = [row["sku"] for row in rows]
    if any(not SKU_RE.fullmatch(sku) for sku in skus) or len(set(skus)) != len(skus):
        raise ValueError("INVALID_OR_COLLIDING_SKU")
    return fallback
def atomic_write(path, text):
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        folder = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(folder)
        finally:
            os.close(folder)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

def source_digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def convert(args):
    exchange_root = Path(args.exchange_root)
    import_path, offers_path = latest_staged_pair(exchange_root)

    source_hashes = {"import_sha256": source_digest(import_path), "offers_sha256": source_digest(offers_path)}
    rows = parse_products(import_path)
    offers = parse_offers(offers_path, args.warehouse_id, args.price_type_id)
    if len(rows) > MAX_PRODUCTS:
        raise ValueError("TOO_MANY_PRODUCTS")
    if not rows or {row["source_id"] for row in rows} != set(offers):
        raise ValueError("INCOMPLETE_OR_MISMATCHED_CATALOG_PAIR")
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
        for field in (row["name"], row["category"], row["barcode"]):
            if field is not None and (not field.strip() or len(field) > 500 or CONTROL_RE.search(field)):
                raise ValueError("INVALID_PRODUCT_TEXT")
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
        **source_hashes,
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

    if source_hashes != {"import_sha256": source_digest(import_path), "offers_sha256": source_digest(offers_path)}:
        raise ValueError("SOURCE_CHANGED_DURING_CONVERSION")
    output = Path(args.output)
    report_path = Path(args.report)
    output.parent.mkdir(parents=True, exist_ok=True)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(snapshot, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    if len(serialized.encode("utf-8")) > MAX_SNAPSHOT_BYTES:
        raise ValueError("SNAPSHOT_TOO_LARGE")
    atomic_write(output, serialized)
    atomic_write(report_path, json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False))
def main():
    args = parse_args()
    root = Path(args.exchange_root).resolve()
    output = Path(args.output).resolve()
    report = Path(args.report).resolve()
    lock = output.with_name(output.name + ".lock")
    if report in (output, lock) or any(path == root or root in path.parents for path in (output, report, lock)):
        raise ValueError("OUTPUT_MUST_NOT_OVERWRITE_SOURCE_OR_REPORT")
    output.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(lock, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        convert(args)
    finally:
        os.close(fd)
        lock.unlink()

if __name__ == "__main__":
    main()
