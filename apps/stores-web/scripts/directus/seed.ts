/**
 * Seed Directus with current V1 mock data.
 *
 * Idempotent: uses deterministic UUIDs derived from slugs and re-uses uploaded
 * files when possible.
 *
 *   DIRECTUS_ADMIN_TOKEN=xxx npm run directus:seed
 *
 * Dry-run (no API writes):
 *   DRY_RUN=1 DIRECTUS_ADMIN_TOKEN=xxx npm run directus:seed
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  mockActualItems,
  mockBonusProgram,
  mockBrands,
  mockCategories,
  mockCities,
  mockFaqs,
  mockPromotions,
  mockStores,
  mockVacancies,
} from "../../lib/data/mock-data";
import { DirectusAdminClient } from "./api-client";
import { generateId } from "./ids";

const UPLOADED_FILES_PATH = resolve(import.meta.dirname ?? __dirname, "uploaded-files.json");

interface FileMapping {
  [localPath: string]: string;
}

async function loadFileMapping(): Promise<FileMapping> {
  try {
    const content = await readFile(UPLOADED_FILES_PATH, "utf-8");
    return JSON.parse(content) as FileMapping;
  } catch {
    return {};
  }
}

async function saveFileMapping(mapping: FileMapping): Promise<void> {
  if (process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true") return;
  const { writeFile } = await import("node:fs/promises");
  await writeFile(UPLOADED_FILES_PATH, JSON.stringify(mapping, null, 2));
}

function publicFilePath(relativePath: string): string {
  return resolve(import.meta.dirname ?? __dirname, "../../public", relativePath.replace(/^\//, ""));
}

async function fileExists(client: DirectusAdminClient, fileId: string): Promise<boolean> {
  try {
    await client.get(`/files/${fileId}`);
    return true;
  } catch {
    return false;
  }
}

function mimeTypeForFilename(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "svg":
      return "image/svg+xml";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}

async function uploadFile(
  client: DirectusAdminClient,
  localPath: string,
  filename: string,
): Promise<string | null> {
  const fullPath = publicFilePath(localPath);
  try {
    const buffer = await readFile(fullPath);
    const formData = new FormData();
    const mimeType = mimeTypeForFilename(filename);
    formData.append("file", new Blob([new Uint8Array(buffer)], { type: mimeType }), filename);
    formData.append("type", mimeType);

    if (client.dryRun) {
      console.log(`[DRY RUN] Upload file ${localPath}`);
      return `dry-run-file-${filename}`;
    }

    const response = await client.post<{ data: { id: string } }>("/files", formData);
    return response.data.id;
  } catch (error) {
    console.warn(`Failed to upload ${localPath}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

async function ensureFile(
  client: DirectusAdminClient,
  mapping: FileMapping,
  localPath: string | null,
): Promise<string | null> {
  if (!localPath || localPath.length === 0) return null;

  const filename = localPath.split("/").pop() ?? localPath;
  const existingId = mapping[localPath];

  if (existingId) {
    const stillExists = await fileExists(client, existingId);
    if (stillExists) return existingId;
  }

  const uploadedId = await uploadFile(client, localPath, filename);
  if (uploadedId) {
    mapping[localPath] = uploadedId;
  }
  return uploadedId;
}

async function itemExists(client: DirectusAdminClient, collection: string, id: string): Promise<boolean> {
  try {
    await client.get(`/items/${collection}/${id}`);
    return true;
  } catch {
    return false;
  }
}

async function upsertItem(
  client: DirectusAdminClient,
  collection: string,
  id: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (client.dryRun) {
    console.log(`[DRY RUN] Upsert ${collection}/${id}`);
    return;
  }

  const exists = await itemExists(client, collection, id);
  if (exists) {
    await client.patch(`/items/${collection}/${id}`, payload);
  } else {
    await client.post(`/items/${collection}`, { ...payload, id });
  }
}

async function upsertSingleton(
  client: DirectusAdminClient,
  collection: string,
  id: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (client.dryRun) {
    console.log(`[DRY RUN] Upsert singleton ${collection}`);
    return;
  }

  // Singletons use a fixed endpoint and require an explicit primary key.
  await client.patch(`/items/${collection}`, { ...payload, id });
}

async function seedBrands(client: DirectusAdminClient, mapping: FileMapping) {
  console.log("Seeding brands...");
  for (const brand of mockBrands) {
    const id = generateId("brands", brand.slug);
    const logoId = await ensureFile(client, mapping, brand.logo);

    await upsertItem(client, "brands", id, {
      slug: brand.slug,
      name: brand.name,
      legal_name: brand.legal_name,
      logo: logoId,
      primary_color: brand.primary_color,
      secondary_color: brand.secondary_color,
      short_description: brand.short_description,
      description: brand.description,
      seo_title: brand.seo_title,
      seo_description: brand.seo_description,
      social_links: brand.social_links,
      active: brand.active,
      created_at: brand.created_at,
      updated_at: brand.updated_at,
    });
  }
}

async function seedCities(client: DirectusAdminClient) {
  console.log("Seeding cities...");
  for (const city of mockCities) {
    const id = generateId("cities", city.slug);
    await upsertItem(client, "cities", id, {
      slug: city.slug,
      name: city.name,
      region: city.region,
      country: city.country,
      latitude: city.latitude ? String(city.latitude) : null,
      longitude: city.longitude ? String(city.longitude) : null,
      active: city.active,
      created_at: city.created_at,
      updated_at: city.updated_at,
    });
  }
}

async function seedStores(client: DirectusAdminClient, mapping: FileMapping) {
  console.log("Seeding stores...");
  for (const store of mockStores) {
    const id = generateId("stores", store.slug);
    const brandId = generateId("brands", store.slug.replace("-amursk", ""));
    const cityId = generateId("cities", "amursk");
    const facadeId = await ensureFile(client, mapping, store.facade_photo);
    const entranceId = await ensureFile(client, mapping, store.entrance_photo);

    const galleryIds: string[] = [];
    for (const photo of store.gallery) {
      const fileId = await ensureFile(client, mapping, photo);
      if (fileId) galleryIds.push(fileId);
    }

    await upsertItem(client, "stores", id, {
      brand_id: brandId,
      city_id: cityId,
      name: store.name,
      slug: store.slug,
      address: store.address,
      postal_code: store.postal_code,
      latitude: store.latitude ? String(store.latitude) : null,
      longitude: store.longitude ? String(store.longitude) : null,
      telephone: store.telephone,
      email: store.email,
      opening_hours: store.opening_hours,
      short_description: store.short_description,
      description: store.description,
      facade_photo: facadeId,
      entrance_photo: entranceId,
      gallery: galleryIds,
      map_links: store.map_links,
      messenger_links: store.messenger_links,
      active: store.active,
      temporarily_closed: store.temporarily_closed,
      seo_title: store.seo_title,
      seo_description: store.seo_description,
      created_at: store.created_at,
      updated_at: store.updated_at,
    });
  }
}

async function seedCategories(client: DirectusAdminClient, mapping: FileMapping) {
  console.log("Seeding categories...");
  for (const category of mockCategories) {
    const brandSlug = mockBrands.find((b) => b.id === category.brand_id)?.slug;
    if (!brandSlug) continue;
    const id = generateId("categories", `${brandSlug}-${category.slug}`);
    const brandId = generateId("brands", brandSlug);
    const imageId = await ensureFile(client, mapping, category.image);

    await upsertItem(client, "categories", id, {
      brand_id: brandId,
      parent_id: null,
      name: category.name,
      slug: category.slug,
      short_description: category.short_description,
      description: category.description,
      image: imageId,
      sort_order: category.sort_order,
      active: category.active,
      created_at: category.created_at,
      updated_at: category.updated_at,
    });
  }
}

async function seedPromotions(client: DirectusAdminClient) {
  if (mockPromotions.length === 0) {
    console.log("No promotions in mock data, skipping.");
    return;
  }
  console.log("Seeding promotions...");
  for (const promotion of mockPromotions) {
    await upsertItem(client, "promotions", promotion.id, { ...promotion });
  }
}

async function seedBonusPrograms(client: DirectusAdminClient) {
  console.log("Seeding bonus programs...");
  const program = mockBonusProgram;
  const participatingBrandIds = program.participating_brands
    .map((brandId) => mockBrands.find((b) => b.id === brandId)?.slug)
    .filter((slug): slug is string => Boolean(slug))
    .map((slug) => generateId("brands", slug));

  const bonusProgramId = generateId("bonus_programs", "main");
  await upsertSingleton(client, "bonus_programs", bonusProgramId, {
    title: program.title,
    short_description: program.short_description,
    description: program.description,
    rules: program.rules,
    participating_brands: participatingBrandIds,
    faq: program.faq,
    active: program.active,
    updated_at: program.updated_at,
  });
}

async function seedFaqs(client: DirectusAdminClient) {
  if (mockFaqs.length === 0) {
    console.log("No FAQs in mock data, skipping.");
    return;
  }
  console.log("Seeding FAQs...");
  for (const faq of mockFaqs) {
    const id = generateId("faqs", faq.id);
    await upsertItem(client, "faqs", id, {
      question: faq.question,
      answer: faq.answer,
      brand_id: null,
      city_id: faq.city_id ? generateId("cities", "amursk") : null,
      store_id: null,
      category_id: null,
      sort_order: faq.sort_order,
      active: faq.active,
    });
  }
}

async function seedVacancies(client: DirectusAdminClient) {
  if (mockVacancies.length === 0) {
    console.log("No vacancies in mock data, skipping.");
    return;
  }
  console.log("Seeding vacancies...");
  for (const vacancy of mockVacancies) {
    await upsertItem(client, "vacancies", vacancy.id, { ...vacancy });
  }
}

async function seedActualItems(client: DirectusAdminClient, mapping: FileMapping) {
  console.log("Seeding actual items...");
  for (const item of mockActualItems) {
    const brandSlug = item.brandId ? mockBrands.find((b) => b.id === item.brandId)?.slug : null;
    const brandId = brandSlug ? generateId("brands", brandSlug) : null;
    const imageId = await ensureFile(client, mapping, item.image);
    const id = generateId("actual_items", item.id);

    await upsertItem(client, "actual_items", id, {
      type: item.type,
      brandId: brandId,
      title: item.title,
      shortText: item.shortText,
      image: imageId,
      imageAlt: item.imageAlt,
      imageOrientation: item.imageOrientation,
      badge: item.badge,
      buttonText: item.buttonText,
      buttonUrl: item.buttonUrl,
      startsAt: item.startsAt,
      endsAt: item.endsAt,
      priority: item.priority,
      active: item.active,
      showOnHome: item.showOnHome,
    });
  }
}

async function main() {
  const directusUrl = process.env.DIRECTUS_URL;
  const token = process.env.DIRECTUS_ADMIN_TOKEN;
  const dryRun = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";

  if (!directusUrl) {
    console.error("DIRECTUS_URL is required");
    process.exit(1);
  }
  if (!token) {
    console.error("DIRECTUS_ADMIN_TOKEN is required for seed operations");
    process.exit(1);
  }

  const client = new DirectusAdminClient({ directusUrl, token, dryRun });
  const mapping = await loadFileMapping();

  console.log(`Seeding Directus at ${directusUrl}${dryRun ? " (dry run)" : ""}`);

  await seedBrands(client, mapping);
  await seedCities(client);
  await seedStores(client, mapping);
  await seedCategories(client, mapping);
  await seedPromotions(client);
  await seedBonusPrograms(client);
  await seedFaqs(client);
  await seedVacancies(client);
  await seedActualItems(client, mapping);

  await saveFileMapping(mapping);
  console.log("Seed complete.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
