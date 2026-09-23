const BASE = "https://sibirskayakoshka.ru/katalog/";

function clean(value) {
  return String(value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function litres(name) {
  const match = String(name ?? "").match(/(\d+(?:[.,]\d+)?)\s*л(?=\s|$|[),.;])/i);
  return match ? match[1].replace(",", "-") : null;
}

export function sourceUrlForLocalName(name) {
  const lower = String(name ?? "").toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
  const l = litres(lower);
  if (!l) return null;

  if (lower.includes("универсал")) return BASE + "supervpityvayushchij-napolnitel-universal-" + l + "l";
  if (lower.includes("бюджет")) return BASE + "supervpityvayushchij-napolnitel-byudzhet-" + l + "l";
  if (lower.includes("лесной")) return BASE + "supervpityvayushchij-drevesnyj-napolnitel-lesnoj-" + l + "l";
  if (lower.includes("супер") && lower.includes("комку")) return BASE + "komkuyushchijsya-napolnitel-super-" + l + "l";
  return null;
}

function block(html, title) {
  const pattern = new RegExp(
    '<div[^>]*class=["\'][^"\']*product__char-title[^"\']*["\'][^>]*>\\s*' + title
      + ':?\\s*</div>\\s*<div[^>]*class=["\'][^"\']*product__char-text[^"\']*["\'][^>]*>([\\s\\S]*?)</div>',
    "i",
  );
  return clean(String(html).match(pattern)?.[1] ?? "");
}

export function parseSibCatProductPage(html, url) {
  const title = clean(String(html).match(/<h1[^>]*class=["'][^"']*product__title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
  const gallery = String(html).match(/<div[^>]*class=["'][^"']*product__gallery-items[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i)?.[1] ?? "";
  const imageUrl = gallery.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] ?? "";
  const composition = block(html, "Состав");
  const advantages = block(html, "Преимущества");
  const description = clean(String(html).match(/<div[^>]*class=["'][^"']*product__descr[^"']*["'][^>]*>[\s\S]*?<p>([\s\S]*?)<\/p>/i)?.[1] ?? "");

  if (!title || !imageUrl) throw new Error(url + ": incomplete Siberian Cat product page");
  return { title, imageUrl: new URL(imageUrl, url).href, composition, advantages, description, sourceUrl: url };
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "AmurskMarket-MiskaCatalog/1.0" },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(url + ": HTTP " + response.status);
  return response.text();
}

export async function fetchSibCatForLocalName(name) {
  const url = sourceUrlForLocalName(name);
  if (!url) return null;
  return parseSibCatProductPage(await fetchText(url), url);
}
