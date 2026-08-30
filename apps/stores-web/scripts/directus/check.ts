/**
 * Check Directus content against V1 expectations.
 *
 *   DIRECTUS_ADMIN_TOKEN=xxx npm run directus:check
 */

import { DirectusAdminClient } from "./api-client";

interface CountResult {
  data: unknown[];
  meta?: { total_count?: number };
}

async function countItems(client: DirectusAdminClient, collection: string): Promise<number> {
  const response = await client.get<CountResult>(`/items/${collection}?limit=0&meta=total_count`);
  return response.meta?.total_count ?? response.data.length;
}

async function main() {
  const directusUrl = process.env.DIRECTUS_URL;
  const token = process.env.DIRECTUS_ADMIN_TOKEN;

  if (!directusUrl) {
    console.error("DIRECTUS_URL is required");
    process.exit(1);
  }
  if (!token) {
    console.error("DIRECTUS_ADMIN_TOKEN is required");
    process.exit(1);
  }

  const client = new DirectusAdminClient({ directusUrl, token });
  console.log(`Checking Directus at ${directusUrl}`);

  const collections = [
    "brands",
    "cities",
    "stores",
    "categories",
    "promotions",
    "bonus_programs",
    "faqs",
    "vacancies",
    "actual_items",
  ];

  for (const collection of collections) {
    try {
      const count = await countItems(client, collection);
      console.log(`  ${collection}: ${count} items`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`  ${collection}: ERROR - ${message}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
