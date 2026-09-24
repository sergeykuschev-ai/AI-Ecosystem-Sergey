const PRODUCTS = new Map([
  ["4603586003548", { url: "https://avzvet.ru/product/bars-sprey-insektoakaritsidnyy-dlya-sobak/200-ml/", expect: "200 мл" }],
  ["4603586004828", { url: "https://avzvet.ru/product/bars-osheynik-insektoakaritsidnyy-dlya-sobak/50-sm/", expect: "50 см" }],
  ["4603586014384", { url: "https://avzvet.ru/product/bars-klassik-kapli-protiv-blokh-i-kleshchey-dlya-s/", expect: "4 штуки" }],
  ["4603586014414", { url: "https://avzvet.ru/product/bars-klassik-kapli-protiv-blokh-i-kleshchey-dlya-k/", expect: "3 штуки" }],
  ["4603586016340", { url: "https://avzvet.ru/product/bars-kapli-ushnye/", expect: "20 мл" }],
  ["4603586004842", { url: "https://avzvet.ru/product/bars-osheynik-insektoakaritsidnyy-dlya-koshek/", expect: "35 см" }],
  ["4603586004835", { url: "https://avzvet.ru/product/bars-osheynik-insektoakaritsidnyy-dlya-sobak/35-sm/", expect: "35 см" }],
  ["4603586013790", { url: "https://avzvet.ru/product/bars-kapli-dlya-sobak-protiv-blokh-i-kleshchey/do-10-kg/", expect: "до 10 кг" }],
  ["4603586013776", { url: "https://avzvet.ru/product/bars-kapli-dlya-sobak-protiv-blokh-i-kleshchey/4-dozy-po-0-67-ml-/", expect: "4 дозы по 0,67 мл" }],
  ["4603586003838", { url: "https://avzvet.ru/product/bars-zooshampun-repellentnyy-dlya-sobak-i-koshek/", expect: "250 мл" }],
  ["4603586005153", { url: "https://avzvet.ru/product/bars-sprey-insektoakaritsidnyy-dlya-sobak/100-ml/", expect: "100 мл" }],
]);

function decode(value) {
  return String(value ?? "")
    .replaceAll("&quot;", '"').replaceAll("&#34;", '"').replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&nbsp;", " ")
    .replaceAll("&#39;", "'").replaceAll("&apos;", "'");
}
function clean(value) {
  return decode(String(value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}
function attr(tag, name) {
  return tag.match(new RegExp(name + "=[\\\"']([^\\\"']*)[\\\"']", "i"))?.[1] ?? "";
}
function meta(html, key, value) {
  for (const tag of String(html).match(/<meta\b[^>]*>/gi) ?? []) {
    if (attr(tag, key).toLowerCase() === value.toLowerCase()) return decode(attr(tag, "content"));
  }
  return "";
}
export function parseAvzBarsProductPage(html, url, expectedVariant) {
  const source = String(html);
  const title = clean(source.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
  const description = clean(meta(source, "name", "description"));
  const gallery = source.match(/<div\s+class=["']product-pic["'][\s\S]*?<div\s+class=["']pic-thumbs/i)?.[0] ?? "";
  const imagePath = gallery.match(/<a\s+href=["']([^"']+)["'][^>]*class=["']fancybox/i)?.[1] ?? "";
  const imageUrl = imagePath ? new URL(imagePath, url).href : "";
  if (!title || !description || !imageUrl) throw new Error(url + ": incomplete AVZ product page");
  if (expectedVariant && !clean(source).toLocaleLowerCase("ru-RU").includes(expectedVariant.toLocaleLowerCase("ru-RU"))) {
    throw new Error(url + ": expected variant not found: " + expectedVariant);
  }
  return { title, description, imageUrl, sourceUrl: url, expectedVariant };
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "AmurskMarket-MiskaCatalog/1.0" },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(url + ": HTTP " + response.status);
  return response.text();
}

export async function fetchAvzBarsByBarcodes(barcodes = []) {
  const wanted = [...new Set(barcodes.map((x) => String(x ?? "").trim()).filter(Boolean))];
  const products = [];
  const failures = [];
  for (const barcode of wanted) {
    const config = PRODUCTS.get(barcode);
    if (!config) {
      failures.push({ barcode, error: "official AVZ mapping not configured" });
      continue;
    }
    try {
      const product = parseAvzBarsProductPage(await fetchText(config.url), config.url, config.expect);
      products.push({ ...product, barcode });
    } catch (error) {
      failures.push({ barcode, url: config.url, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { products, byBarcode: new Map(products.map((p) => [p.barcode, p])), failures };
}
