import { readFile } from "node:fs/promises";

export const MISKA_PRICE_TYPE_ID = "d082a97c-f6e9-11ee-b410-bc98e9dba613";
export const MISKA_WAREHOUSE_ID = "fb68b067-ff65-11ed-b86a-7c8bca00854e";

function decodeXml(value) {
  return value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'").replaceAll("&amp;", "&");
}

function blocks(xml, tag) {
  const pattern = new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">", "g");
  return [...xml.matchAll(pattern)].map((match) => match[1]);
}

function directText(xml, tag) {
  const match = xml.match(new RegExp("<" + tag + "(?:\\s[^>]*)?>([^<]*)</" + tag + ">"));
  return match ? decodeXml(match[1].trim()) : "";
}

function numberValue(value) {
  const normalized = String(value ?? "").replace(/\u00a0/g, "").replace(",", ".").trim();
  if (!normalized) return null;
  const result = Number(normalized);
  return Number.isFinite(result) ? result : null;
}
function attributeMap(source) {
  const result = {};
  for (const match of source.matchAll(/([\p{L}\w:-]+)="([^"]*)"/gu)) result[match[1]] = decodeXml(match[2]);
  return result;
}

function targetPrice(offerXml, priceTypeId) {
  const matches = blocks(offerXml, "Цена")
    .filter((block) => directText(block, "ИдТипаЦены") === priceTypeId);
  if (matches.length !== 1) throw new Error(`offer has ${matches.length} target prices, expected 1`);
  const value = numberValue(directText(matches[0], "ЦенаЗаЕдиницу"));
  if (value === null || value < 0) throw new Error("target price is not a valid non-negative number");
  return value === 0 ? null : value;
}

function targetStock(offerXml, warehouseId) {
  const matches = [...offerXml.matchAll(/<Склад\s+([^>]*)\/>/g)]
    .map((match) => attributeMap(match[1]))
    .filter((attrs) => attrs.ИдСклада === warehouseId);
  if (matches.length !== 1) throw new Error(`offer has ${matches.length} target warehouse rows, expected 1`);
  const raw = numberValue(matches[0].КоличествоНаСкладе);
  if (raw === null) throw new Error("target stock is not numeric");
  return { rawStockQuantity: raw, stockQuantity: Math.max(0, raw) };
}
export function parseOffersCommerceMl(xml, options = {}) {
  const priceTypeId = options.priceTypeId ?? MISKA_PRICE_TYPE_ID;
  const warehouseId = options.warehouseId ?? MISKA_WAREHOUSE_ID;
  const offers = blocks(xml, "Предложение").map((block) => {
    const externalId = directText(block, "Ид");
    if (!externalId) throw new Error("offer is missing Ид");
    const stock = targetStock(block, warehouseId);
    return {
      externalId,
      price: targetPrice(block, priceTypeId),
      stockQuantity: stock.stockQuantity,
      rawStockQuantity: stock.rawStockQuantity,
    };
  });
  const ids = new Set();
  for (const offer of offers) {
    if (ids.has(offer.externalId)) throw new Error(`duplicate offer id: ${offer.externalId}`);
    ids.add(offer.externalId);
  }
  return { priceTypeId, warehouseId, offers };
}

export async function parseOffersCommerceMlFile(path, options) {
  return parseOffersCommerceMl(await readFile(path, "utf8"), options);
}
