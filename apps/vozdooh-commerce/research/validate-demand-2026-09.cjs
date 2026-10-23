/* eslint-disable @typescript-eslint/no-require-imports -- Standalone research validation. */
// Validate the frozen research contract; never rewrite inventory or the ranking.
// Usage: node research/validate-demand-2026-09.cjs [research-directory]
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const directory = process.argv[2] ? path.resolve(process.argv[2]) : __dirname;
const appRoot = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(directory, name), "utf8");
const data = JSON.parse(read("demand-evidence-2026-09.json"));
const report = read("demand-priority-2026-09.md");
const snapshotBytes = fs.readFileSync(data.snapshot.path);
const snapshot = JSON.parse(snapshotBytes).products;
const tiers = ["CORE / PRIORITY", "STRONG", "NORMAL", "SLOW", "CLEARANCE"];
const bestsellerTypes = new Set(["bestseller_badge", "bestseller_section", "seller_bestseller_statement"]);
const accessories = new Set(["diffuser_sticks", "power_adapter", "wick_trimmer", "potpourri_vessel"]);
const consumerTypes = new Set([
  "reed_diffuser", "diffuser_refill", "candle", "room_spray", "car_sachet",
  "car_fragrance", "scented_sachet", "potpourri", "potpourri_refresher",
  "water_soluble_fragrance", "gift_set",
]);
const asciiCompare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const unique = (rows, key) => {
  const result = new Map(rows.map((row) => [row[key], row]));
  assert.equal(result.size, rows.length, `Duplicate ${key}`);
  return result;
};
const nonempty = (value, label) => assert.ok(typeof value === "string" && value.trim(), label);
const nullableText = (value, label) => assert.ok(value === null || typeof value === "string", label);
const groups = (sources, predicate) => new Set(sources.filter(predicate).map((source) => source.independence_group)).size;

assert.equal(data.schema_version, 1);
assert.equal(data.checked_at, "2026-09-24");
assert.equal(createHash("sha256").update(snapshotBytes).digest("hex"), data.snapshot.sha256,
  "Snapshot changed: commission a new dated review; do not silently recalculate this report");
assert.equal(snapshot.length, data.snapshot.all_rows);
const positive = unique(snapshot.filter((row) => row.stock > 0), "sku");
const products = unique(data.products, "sku");
const sources = unique(data.sources, "id");
assert.deepEqual([...products.keys()].sort(), [...positive.keys()].sort(), "Positive-stock SKU coverage");
assert.equal(products.size, data.snapshot.positive_skus);
assert.equal(products.size, 148, "This dated report covers exactly 148 positive SKUs");
assert.equal(data.products.reduce((sum, product) => sum + product.stock, 0), data.snapshot.positive_units);
assert.equal(data.snapshot.positive_units, 220);

for (const source of sources.values()) {
  for (const key of ["id", "source", "independence_group", "signal_type", "description", "access_method", "scope"]) {
    nonempty(source[key], `${source.id}: ${key}`);
  }
  assert.ok(["http:", "https:"].includes(new URL(source.url).protocol));
  assert.ok(["brand", "retailer", "marketplace"].includes(source.source_role));
  assert.ok(["high", "medium", "low"].includes(source.confidence));
  assert.ok(["A", "B"].includes(source.signal_class));
  assert.equal(source.checked_at, data.checked_at);
  assert.equal(source.sales_count, null, "No published unit sales established in this review");
  for (const key of ["review_count", "rating_count"]) {
    assert.ok(source[key] === null || (Number.isInteger(source[key]) && source[key] >= 0), `${source.id}: ${key}`);
  }
  assert.ok(source.rating === null || (source.rating >= 0 && source.rating <= source.rating_scale));
  if (source.signal_class === "A") {
    assert.notEqual(source.source_role, "marketplace");
    assert.ok(bestsellerTypes.has(source.signal_type) || source.signal_type === "published_reviews");
  }
}

const usedSources = new Set();
for (const product of products.values()) {
  const raw = positive.get(product.sku);
  assert.equal(product.original_name, raw.name, `${product.sku}: original name`);
  assert.equal(product.stock, raw.stock, `${product.sku}: stock`);
  assert.equal(product.trade.price, null);
  assert.equal(product.aging, "unknown");
  assert.equal(product.first_received_at, null);
  for (const key of ["sku", "original_name", "display_title", "product_type", "rationale"]) {
    nonempty(product[key], `${product.sku}: ${key}`);
  }
  for (const key of ["brand", "volume", "collection", "fragrance", "image", "description"]) {
    nullableText(product[key], `${product.sku}: ${key}`);
  }
  assert.ok(tiers.includes(product.tier));
  assert.ok(Array.isArray(product.existing_images));
  assert.ok(Array.isArray(product.evidence) && product.evidence.length);
  const quality = product.quality;
  assert.equal(quality.image_present, Boolean(product.image));
  const imageExists = Boolean(product.image && fs.existsSync(path.join(appRoot, "public", product.image)));
  assert.equal(quality.image_file_exists, imageExists, `${product.sku}: image file`);
  assert.equal(quality.description_present, Boolean(product.description));
  assert.equal(product.promotion_blocked, Boolean(quality.identity_blocker) || !imageExists);
  assert.equal(product.high_stock_push, product.stock >= 3);
  if (accessories.has(product.product_type)) {
    assert.equal(product.volume, null, "Accessory compatibility is not liquid volume");
    assert.equal(product.fragrance, null);
  }
  const matched = [];
  const evidenceIds = new Set();
  for (const evidence of product.evidence) {
    assert.ok(["A", "B", "C"].includes(evidence.signal_class));
    if (evidence.signal_class === "C") {
      assert.equal(evidence.evidence_id, null);
      assert.equal(evidence.url, null);
      assert.equal(evidence.checked_at, data.checked_at);
      nonempty(evidence.query, `${product.sku}: no-match search query`);
      continue;
    }
    const source = sources.get(evidence.evidence_id);
    assert.ok(source, `${product.sku}: unknown evidence ${evidence.evidence_id}`);
    assert.ok(!evidenceIds.has(source.id), `${product.sku}: repeated observation`);
    evidenceIds.add(source.id);
    usedSources.add(source.id);
    matched.push(source);
    assert.equal(evidence.source_signal_class, source.signal_class);
    const exact = evidence.scope === "exact_brand_fragrance_format_volume";
    assert.equal(evidence.signal_class, exact ? source.signal_class : "B", "Fragrance inference must remain B at SKU level");
  }
  const counts = {
    A: product.evidence.filter((evidence) => evidence.signal_class === "A").length,
    B: product.evidence.filter((evidence) => evidence.signal_class === "B").length,
    fragrance_A: matched.filter((source) => source.signal_class === "A").length,
    C: matched.length ? 0 : 1,
    independent_non_marketplace: groups(matched, (source) => source.source_role !== "marketplace"),
    independent_direct: groups(matched, (source) => source.signal_class === "A"),
    independent_bestseller: groups(matched, (source) => bestsellerTypes.has(source.signal_type)),
    independent_ru_retail: groups(matched, (source) => source.market === "RU" && source.source_role === "retailer"),
  };
  assert.deepEqual(product.evidence_counts, counts, `${product.sku}: evidence counts`);
  assert.equal(product.evidence.filter((evidence) => evidence.signal_class === "C").length, counts.C);
  assert.equal(product.search_audit.matched_evidence_count, matched.length);
  assert.equal(product.search_audit.checked_at, data.checked_at);
  nonempty(product.search_audit.query, `${product.sku}: search audit`);
  const ready = imageExists && quality.description_present && !quality.identity_blocker;
  let expectedTier = "SLOW";
  if (ready && !accessories.has(product.product_type) && counts.independent_bestseller >= 2) {
    expectedTier = "CORE / PRIORITY";
  } else if (ready && !accessories.has(product.product_type) &&
    ((counts.independent_direct >= 1 && counts.independent_non_marketplace >= 2) || counts.independent_ru_retail >= 2)) {
    expectedTier = "STRONG";
  } else if (ready && matched.length) {
    expectedTier = "NORMAL";
  }
  assert.equal(product.tier, expectedTier, `${product.sku}: tier rules`);
  assert.equal(product.bestseller_label_eligible, expectedTier === "CORE / PRIORITY");
  assert.equal(Boolean(product.card_preparation), ["CORE / PRIORITY", "STRONG"].includes(expectedTier));
  if (product.card_preparation) {
    const card = product.card_preparation;
    assert.equal(card.status, "research_draft_not_published");
    assert.equal(card.best_existing_image, product.image);
    assert.equal(card.volume, product.volume);
    assert.equal(card.brand, product.brand);
    assert.equal(card.collection, product.collection);
    for (const key of ["clean_name", "description_draft", "seo_title_draft", "seo_description_draft", "room_or_scenario", "russian_name_status"]) {
      nonempty(card[key], `${product.sku}: card ${key}`);
    }
    assert.ok(Array.isArray(card.main_notes));
    if (card.main_notes.length) assert.ok(evidenceIds.has(card.fact_evidence_id));
    if (card.duration) assert.ok(evidenceIds.has(card.duration.evidence_id));
    for (const sku of card.related_skus_same_fragrance) {
      assert.notEqual(sku, product.sku);
      assert.equal(products.get(sku)?.group_index, product.group_index);
      assert.ok(positive.has(sku));
    }
    assert.deepEqual(card.other_volumes_same_fragrance.map((item) => item.sku), card.related_skus_same_fragrance);
  }
}
assert.equal(usedSources.size, sources.size, "Unreferenced sources");
assert.deepEqual(data.tier_breakdown, Object.fromEntries(tiers.map((tier) => [tier, data.products.filter((product) => product.tier === tier).length])));

const rankCompare = (left, right) => {
  const keys = ["independent_bestseller", "independent_direct", "independent_ru_retail"];
  let difference = tiers.indexOf(left.tier) - tiers.indexOf(right.tier);
  for (const key of keys) difference ||= right.evidence_counts[key] - left.evidence_counts[key];
  difference ||= right.stock - left.stock;
  difference ||= right.evidence_counts.independent_non_marketplace - left.evidence_counts.independent_non_marketplace;
  return difference || asciiCompare(left.sku, right.sku);
};
const top = data.products.filter((product) => consumerTypes.has(product.product_type) && !product.promotion_blocked && product.tier !== "SLOW").sort(rankCompare).slice(0, 25);
assert.deepEqual(data.top_skus, top.map((product) => product.sku));
for (const product of products.values()) {
  const index = data.top_skus.indexOf(product.sku);
  assert.equal(product.promotion_rank, index < 0 ? null : index + 1);
  if (index >= 0) assert.ok(report.includes(`\`${product.sku}\``));
}
assert.deepEqual(data.high_stock_skus, data.products.filter((product) => product.stock >= 3)
  .sort((left, right) => right.stock - left.stock || asciiCompare(left.sku, right.sku)).map((product) => product.sku));

// RFC 4180: preserve quoted commas, escaped quotes and embedded newlines.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index += 1; }
      else { assert.ok(quoted || field === "", "Malformed CSV quotation"); quoted = !quoted; }
    } else if (!quoted && character === ",") {
      row.push(field); field = "";
    } else if (!quoted && (character === "\r" || character === "\n")) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += character;
  }
  assert.ok(!quoted, "Unclosed CSV quotation");
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const [headers, ...csvRows] = parseCsv(read("demand-priority-2026-09.csv"));
assert.deepEqual(headers, [
  "sku", "brand", "original_name", "display_title", "product_type", "volume", "collection", "fragrance",
  "stock", "aging", "trade_price", "has_image", "has_description", "tier", "evidence_A", "evidence_B",
  "evidence_C", "fragrance_A", "independent_sources", "independent_A", "independent_bestseller",
  "independent_ru_retail", "promotion_rank", "high_stock_push", "promotion_blocked", "rationale",
]);
assert.equal(csvRows.length, products.size);
const csv = unique(csvRows.map((row) => {
  assert.equal(row.length, headers.length, "CSV column count");
  return Object.fromEntries(headers.map((header, index) => [header, row[index]]));
}), "sku");
const csvValue = (value) => value === null || value === undefined ? "" : typeof value === "boolean" ? (value ? "True" : "False") : String(value);
for (const [sku, row] of csv) {
  const product = products.get(sku);
  assert.ok(product, `Unknown CSV SKU ${sku}`);
  const count = product.evidence_counts;
  const expected = {
    ...product, trade_price: "null", has_image: product.quality.image_file_exists,
    has_description: product.quality.description_present, evidence_A: count.A, evidence_B: count.B,
    evidence_C: count.C, fragrance_A: count.fragrance_A, independent_sources: count.independent_non_marketplace,
    independent_A: count.independent_direct, independent_bestseller: count.independent_bestseller,
    independent_ru_retail: count.independent_ru_retail,
  };
  for (const header of headers) {
    assert.ok(Object.hasOwn(expected, header), `Unexpected CSV header ${header}`);
    assert.equal(row[header], csvValue(expected[header]), `${sku}: CSV ${header}`);
  }
}
console.log(`Validated ${products.size} SKUs / ${data.snapshot.positive_units} units, ${sources.size} sources, TOP-${top.length}, ${data.high_stock_skus.length} high-stock SKUs; JSON/CSV/ranking/snapshot consistent.`);
