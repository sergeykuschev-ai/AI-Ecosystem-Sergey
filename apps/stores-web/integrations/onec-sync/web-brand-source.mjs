const SOURCE_CONFIG = {
  AlphaPet: {
    sitemapUrl: "https://alphapet.ru/sitemap-iblock-18.xml",
    parser: "alphapet",
  },
  Sirius: {
    sitemapUrl: "https://sirius-pet.ru/sitemap-iblock-6.xml",
    parser: "sirius",
  },
};

function decodeHtml(value) {
  return String(value ?? "")
    .replaceAll("&quot;", '"')
    .replaceAll("&#34;", '"')
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function stripTags(value) {
  return decodeHtml(String(value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(name + "=[\"']([^\"']*)[\"']", "i"));
  return match ? decodeHtml(match[1].trim()) : "";
}

function metaContent(html, key, value) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (attribute(tag, key).toLocaleLowerCase("ru-RU") === value.toLocaleLowerCase("ru-RU")) {
      return attribute(tag, "content");
    }
  }
  return "";
}

function pageTitle(html) {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return match ? stripTags(match[1]) : "";
}

function absoluteUrl(value, pageUrl) {
  if (!value) return "";
  try {
    return new URL(value, pageUrl).href;
  } catch {
    return "";
  }
}

export function parseSitemap(xml) {
  return [...String(xml).matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => decodeHtml(match[1].trim()));
}

function parseAlphaPetPage(html, url) {
  const imageTags = html.match(/<img\b[^>]*class=["'][^"']*\bmain-img\b[^"']*["'][^>]*>/gi) ?? [];
  if (!imageTags.length) return null;

  const first = imageTags[0];
  const imageUrl = absoluteUrl(attribute(first, "src") || attribute(first, "data-src"), url);
  const imageTitle = attribute(first, "title");
  const title = imageTitle || pageTitle(html);
  const description = metaContent(html, "name", "description");
  if (!title || !description || !imageUrl) return null;

  return {
    brand: "AlphaPet",
    title,
    pageTitle: pageTitle(html),
    description,
    imageUrl,
    sourceUrl: url,
    matchText: [title, pageTitle(html), description].filter(Boolean).join(" "),
  };
}

function parseSiriusPage(html, url) {
  if (!/class=["'][^"']*\bfeed-item\b/i.test(html)) return null;
  const imageBlock = html.match(/<div\b[^>]*class=["'][^"']*\bitem-feed-info__img\b[^"']*["'][^>]*>[\s\S]{0,5000}?<\/div>/i)?.[0] ?? "";
  const imageTag = imageBlock.match(/<img\b[^>]*>/i)?.[0] ?? "";
  const imageUrl = absoluteUrl(attribute(imageTag, "src") || attribute(imageTag, "data-src"), url);
  const title = metaContent(html, "property", "og:title") || pageTitle(html);
  const description = metaContent(html, "name", "description") || metaContent(html, "property", "og:description");
  if (!title || !description || !imageUrl) return null;

  return {
    brand: "Sirius",
    title: stripTags(title),
    pageTitle: pageTitle(html),
    description: stripTags(description),
    imageUrl,
    sourceUrl: url,
    matchText: [title, pageTitle(html), description].filter(Boolean).join(" "),
  };
}

export function parseBrandPage(brand, html, url) {
  const config = SOURCE_CONFIG[brand];
  if (!config) throw new Error("unsupported web source brand: " + brand);
  return config.parser === "alphapet" ? parseAlphaPetPage(html, url) : parseSiriusPage(html, url);
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "AmurskMarket-MiskaCatalog/1.0" },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(url + ": HTTP " + response.status);
  return response.text();
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function productKey(product) {
  return [product.title, product.description]
    .join("|")
    .toLocaleLowerCase("ru-RU")
    .replace(/\s+/g, " ")
    .trim();
}

export function getWebBrandConfig(brand) {
  const config = SOURCE_CONFIG[brand];
  if (!config) throw new Error("unsupported web source brand: " + brand);
  return config;
}

export async function fetchWebBrandCatalog(brand, options = {}) {
  const config = getWebBrandConfig(brand);
  const urls = parseSitemap(await fetchText(config.sitemapUrl));
  const failures = [];
  const pages = await mapLimit(urls, options.concurrency ?? 8, async (url) => {
    try {
      return parseBrandPage(brand, await fetchText(url), url);
    } catch (error) {
      failures.push({ url, error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  });

  const byKey = new Map();
  for (const product of pages.filter(Boolean)) {
    const key = productKey(product);
    if (!byKey.has(key)) byKey.set(key, product);
  }

  return {
    brand,
    products: [...byKey.values()],
    failures,
    sourceCount: urls.length,
  };
}
