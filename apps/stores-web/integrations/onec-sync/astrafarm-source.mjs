const PRODUCTS = new Map([
  ["4607086630143", "https://astrafarm.com/catalog/kontratseptivnye/kontrseks-neo/kontrseks-neo-kapli-dlya-kotov-i-kobelei/"],
  ["4607086630136", "https://astrafarm.com/catalog/kontratseptivnye/kontrseks-neo/kontrseks-neo-kapli-dlya-koshek-i-suk/"],
]);

function decode(value) {
  return String(value ?? "")
    .replaceAll("&quot;", '"')
    .replaceAll("&#34;", '"')
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'");
}

function clean(value) {
  return decode(String(value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function attr(tag, name) {
  const m = tag.match(new RegExp(name + "=[\\\"']([^\\\"']*)[\\\"']", "i"));
  return m ? decode(m[1].trim()) : "";
}

function meta(html, key, value) {
  for (const tag of String(html).match(/<meta\b[^>]*>/gi) ?? []) {
    if (attr(tag, key).toLowerCase() === value.toLowerCase()) return attr(tag, "content");
  }
  return "";
}
export function parseAstraFarmProductPage(html, url) {
  const title = clean(String(html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
  const gtin = String(html).match(/GTIN[^0-9]*(\d{13,14})/i)?.[1] ?? "";
  const description = meta(html, "name", "description") || meta(html, "property", "og:description");
  const imageUrl = meta(html, "property", "og:image");
  if (!title || !gtin || !description || !imageUrl) throw new Error(url + ": incomplete AstraFarm product page");
  return { title, gtin, description: clean(description), imageUrl, sourceUrl: url };
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "AmurskMarket-MiskaCatalog/1.0" },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(url + ": HTTP " + response.status);
  return response.text();
}

export async function fetchAstraFarmByBarcodes(barcodes = []) {
  const wanted = [...new Set(barcodes.map((x) => String(x ?? "").trim()).filter(Boolean))];
  const products = [];
  const failures = [];
  for (const barcode of wanted) {
    const url = PRODUCTS.get(barcode);
    if (!url) { failures.push({ barcode, error: "official barcode not mapped" }); continue; }
    try {
      const product = parseAstraFarmProductPage(await fetchText(url), url);
      if (product.gtin !== barcode) throw new Error("GTIN mismatch: " + product.gtin);
      products.push(product);
    } catch (error) {
      failures.push({ barcode, url, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { products, byBarcode: new Map(products.map((p) => [p.gtin, p])), failures };
}
