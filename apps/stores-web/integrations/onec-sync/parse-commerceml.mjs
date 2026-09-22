import { readFile } from "node:fs/promises";

function decodeXml(value) {
  return value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&amp;", "&");
}
function blocks(xml, tag) {
  const pattern = new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">", "g");
  return [...xml.matchAll(pattern)].map((match) => match[1]);
}
function rawText(xml, tag) {
  const block = blocks(xml, tag)[0];
  return block ? decodeXml(block.replace(/<[^>]+>/g, "").trim()) : "";
}
function directText(xml, tag) {
  const pattern = new RegExp("<" + tag + "(?:\\s[^>]*)?>([^<]*)</" + tag + ">");
  const match = xml.match(pattern);
  return match ? decodeXml(match[1].trim()) : "";
}
function groupIds(productXml) {
  const start = productXml.indexOf("<Группы>");
  const end = productXml.indexOf("</Группы>", start);
  if (start < 0 || end < 0) return [];
  const section = productXml.slice(start + "<Группы>".length, end);
  return [...section.matchAll(/<Ид>([^<]+)<\/Ид>/g)]
    .map((item) => decodeXml(item[1].trim()))
    .filter(Boolean);
}
function unit(productXml) {
  const match = productXml.match(/<БазоваяЕдиница\b([^>]*)>/);
  if (!match) return "";
  const full = match[1].match(/НаименованиеПолное="([^"]*)"/);
  const code = match[1].match(/Код="([^"]*)"/);
  return decodeXml(full?.[1] ?? code?.[1] ?? "");
}

export function parseCommerceMl(xml) {
  const groups = [...xml.matchAll(/<Группа(?:\s[^>]*)?>\s*<Ид>([^<]+)<\/Ид>\s*<Наименование>([^<]+)<\/Наименование>/g)]
    .map((match) => ({ externalId: decodeXml(match[1].trim()), name: decodeXml(match[2].trim()) }));

  const products = blocks(xml, "Товар")
    .map((block) => ({
      externalId: directText(block, "Ид"),
      sku: directText(block, "Артикул"),
      name: directText(block, "Наименование"),
      barcode: directText(block, "Штрихкод"),
      unit: unit(block),
      groupIds: groupIds(block),
      description: rawText(block, "Описание"),
    }))
    .filter((item) => item.externalId && item.name);

  return { groups, products };
}
export async function parseCommerceMlFile(path) {
  return parseCommerceMl(await readFile(path, "utf8"));
}
