import { readDirectusItems } from "@/lib/directus/client";

export interface MiskaCatalogCategory {
  external_id: string;
  parent_external_id: string | null;
  name: string;
  slug: string;
  sort_order: number;
}

export interface MiskaCatalogProduct {
  external_id: string;
  sku: string | null;
  barcode: string | null;
  name: string;
  unit: string | null;
  category_external_id: string | null;
  description: string | null;
  price: number | string | null;
  stock_quantity: number | string | null;
  offers_synced_at: string | null;
}

export async function getMiskaCatalogPreview() {
  const categories = await readDirectusItems<MiskaCatalogCategory>(
    "miska_catalog_categories",
    ["external_id", "parent_external_id", "name", "slug", "sort_order"],
    "sort=sort_order&limit=-1",
  );
  const products = await readDirectusItems<MiskaCatalogProduct>(
    "miska_catalog_products",
    ["external_id", "sku", "barcode", "name", "unit", "category_external_id", "description", "price", "stock_quantity", "offers_synced_at"],
    "sort=name&limit=-1",
  );
  return { categories: categories ?? [], products: products ?? [] };
}
