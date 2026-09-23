function requireConfig() {
  const base = (process.env.DIRECTUS_URL || "").replace(/\/$/, "");
  const token = process.env.DIRECTUS_ADMIN_TOKEN || "";
  if (!base || !token) throw new Error("DIRECTUS_URL and DIRECTUS_ADMIN_TOKEN are required");
  return { base, token };
}

async function jsonRequest(config, method, path, body) {
  const response = await fetch(config.base + path, {
    method,
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

async function targets(config, brand) {
  const query = new URLSearchParams({
    fields: "id,external_id,sku,name,image_source_url,site_image,site_description",
    "filter[brand][_eq]": brand,
    "filter[stock_quantity][_gt]": "0",
    "filter[image_source_url][_nnull]": "true",
    "filter[site_image][_null]": "true",
    limit: "-1",
  });
  const response = await jsonRequest(config, "GET", `/items/miska_catalog_products?${query}`);
  return response?.data ?? [];
}

function extension(contentType) {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  return "jpg";
}

async function uploadImage(config, brand, product) {
  const response = await fetch(product.image_source_url, {
    headers: { "User-Agent": "AmurskMarket-MiskaCatalog/1.0" },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`${product.sku}: image HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") || "image/jpeg";
  if (!contentType.startsWith("image/")) throw new Error(`${product.sku}: unexpected content type ${contentType}`);
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > 12 * 1024 * 1024) {
    throw new Error(`${product.sku}: invalid image size ${bytes.byteLength}`);
  }

  const form = new FormData();
  const safeBrand = brand.toLocaleLowerCase("ru-RU").replace(/[^a-zа-я0-9]+/gi, "-").replace(/^-|-$/g, "");
  const filename = `miska-${safeBrand}-${product.sku || product.external_id}.${extension(contentType)}`;
  form.append("file", new Blob([bytes], { type: contentType }), filename);
  form.append("title", product.name);

  const upload = await fetch(config.base + "/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}` },
    body: form,
  });
  if (!upload.ok) throw new Error(`${product.sku}: Directus file upload ${upload.status} ${await upload.text()}`);
  const fileId = (await upload.json())?.data?.id;
  if (!fileId) throw new Error(`${product.sku}: Directus did not return file id`);

  await jsonRequest(config, "PATCH", `/items/miska_catalog_products/${product.id}`, {
    site_image: fileId,
    content_status: product.site_description ? "ready" : "enriching",
  });
  return { sku: product.sku, fileId, bytes: bytes.byteLength };
}

export async function uploadSourceImages(brand, { dryRun = false } = {}) {
  const config = requireConfig();
  const rows = await targets(config, brand);
  if (dryRun) {
    return {
      brand,
      targets: rows.length,
      dryRun: true,
      sample: rows.slice(0, 5).map((row) => ({ sku: row.sku, url: row.image_source_url })),
    };
  }

  const uploaded = [];
  const failures = [];
  for (const product of rows) {
    try {
      uploaded.push(await uploadImage(config, brand, product));
    } catch (error) {
      failures.push({ sku: product.sku, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return {
    brand,
    targets: rows.length,
    uploaded: uploaded.length,
    failures,
    bytes: uploaded.reduce((sum, row) => sum + row.bytes, 0),
  };
}

if (process.argv[1]?.endsWith("upload-source-images.mjs")) {
  const brand = process.argv[2];
  if (!brand) throw new Error("usage: node upload-source-images.mjs <brand> [--dry-run]");
  console.log(JSON.stringify(await uploadSourceImages(brand, { dryRun: process.argv.includes("--dry-run") }), null, 2));
}
