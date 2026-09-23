
import { fetchWebBrandCatalog, getWebBrandConfig } from "./web-brand-source.mjs";
import { matchWebBrandProduct } from "./web-brand-match.mjs";
import { composePetProductDescription } from "./pet-content.mjs";

function requireConfig() {
  const base = (process.env.DIRECTUS_URL || "").replace(/\/$/, "");
  const token = process.env.DIRECTUS_ADMIN_TOKEN || "";
  if (!base || !token) throw new Error("DIRECTUS_URL and DIRECTUS_ADMIN_TOKEN are required");
  return { base, token };
}

async function request(config, method, path, body) {
  const response = await fetch(config.base + path, {
    method,
    headers: { Authorization: "Bearer " + config.token, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(method + " " + path + ": " + response.status + " " + await response.text());
  return response.status === 204 ? null : response.json();
}

async function targetProducts(config, brand) {
  const query = new URLSearchParams({
    fields: "id,external_id,sku,barcode,name,stock_quantity,site_name,site_description,site_image,site_category",
    "filter[brand][_eq]": brand,
    "filter[stock_quantity][_gt]": "0",
    limit: "-1",
  });
  const response = await request(config, "GET", "/items/miska_catalog_products?" + query);
  return response?.data ?? [];
}

function packageWeight(name) {
  const match = String(name ?? "").match(/(\d+(?:[.,]\d+)?)\s*(кг|гр|г)(?=\s|$|[),.;"'])/i);
  if (!match) return "";
  const number = match[1].replace(".", ",");
  const unit = match[2].toLocaleLowerCase("ru-RU") === "гр" ? "г" : match[2].toLocaleLowerCase("ru-RU");
  return number + " " + unit;
}

function siteName(brand, localName, sourceTitle) {
  let title = String(sourceTitle ?? "").replace(/\s+/g, " ").trim().replace(/[.\s]+$/g, "");
  if (brand === "Sirius") {
    title = title.replace(/\s*-\s*/g, " — ").replace(/Sirius/gi, "SIRIUS");
  }
  const weight = packageWeight(localName);
  if (weight && !title.toLocaleLowerCase("ru-RU").includes(weight.toLocaleLowerCase("ru-RU"))) {
    title += ", " + weight;
  }
  return title || localName;
}

export async function enrichWebBrand(brand, options = {}) {
  getWebBrandConfig(brand);
  const directus = requireConfig();
  const targets = await targetProducts(directus, brand);
  const official = await fetchWebBrandCatalog(brand, {
    concurrency: options.concurrency ?? Number(process.env.SOURCE_CONCURRENCY || 8),
  });

  const matched = [];
  const unmatched = [];
  const matchOptions = options.matchOptions ?? (brand === "AlphaPet"
    ? { threshold: 45, margin: 8 }
    : { threshold: 70, margin: 10 });
  for (const product of targets) {
    const match = matchWebBrandProduct(product, official.products, matchOptions);
    if (!match.ok) {
      unmatched.push({
        externalId: product.external_id,
        sku: product.sku,
        barcode: product.barcode,
        name: product.name,
        reason: match.reason,
        bestScore: match.bestScore,
        secondScore: match.secondScore,
        bestTitle: match.best?.title ?? null,
      });
      continue;
    }
    matched.push({ product, source: match.candidate, score: match.score, reasons: match.reasons });
  }

  if (options.dryRun) {
    return {
      brand,
      targets: targets.length,
      matched: matched.length,
      unmatched,
      sourceProducts: official.products.length,
      sourcePages: official.sourceCount,
      sourceFailures: official.failures,
      samples: matched.slice(0, 10).map(({ product, source, score }) => ({
        local: product.name,
        official: source.title,
        score,
      })),
      dryRun: true,
    };
  }

  const syncedAt = new Date().toISOString();
  for (const { product, source } of matched) {
    const name = product.site_name || siteName(brand, product.name, source.title);
    const description = product.site_description || composePetProductDescription({
      title: name,
      sourceDescription: source.description,
      siteCategory: product.site_category,
    });
    await request(directus, "PATCH", "/items/miska_catalog_products/" + product.id, {
      site_name: name,
      site_description: description,
      content_source_url: source.sourceUrl,
      image_source_url: source.imageUrl,
      source_title: source.title,
      source_description: source.description,
      content_status: description && product.site_image ? "ready" : "enriching",
      content_synced_at: syncedAt,
    });
  }

  return {
    brand,
    targets: targets.length,
    matched: matched.length,
    unmatched,
    sourceProducts: official.products.length,
    sourceFailures: official.failures,
    updated: matched.length,
    contentSyncedAt: syncedAt,
  };
}

if (process.argv[1]?.endsWith("enrich-web-brand-directus.mjs")) {
  const brand = process.argv[2];
  if (!brand) throw new Error("usage: node enrich-web-brand-directus.mjs <brand> [--dry-run]");
  console.log(JSON.stringify(await enrichWebBrand(brand, { dryRun: process.argv.includes("--dry-run") }), null, 2));
}
