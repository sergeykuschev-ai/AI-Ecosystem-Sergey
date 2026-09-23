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
  site_name: string | null;
  site_description: string | null;
  site_image: string | null;
  content_status: string | null;
  site_section: string | null;
  site_category: string | null;
  site_subcategory: string | null;
  brand: string | null;
  classification_status: string | null;
  classification_confidence: number | null;
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
    ["external_id", "sku", "barcode", "name", "unit", "category_external_id", "description", "site_name", "site_description", "site_image", "content_status", "site_section", "site_category", "site_subcategory", "brand", "classification_status", "classification_confidence", "price", "stock_quantity", "offers_synced_at"],
    "sort=name&limit=-1",
  );
  return { categories: categories ?? [], products: products ?? [] };
}
