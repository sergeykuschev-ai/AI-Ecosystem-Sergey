import { NextResponse } from "next/server";
import { getBrands } from "@/lib/directus/brands";
import { getCategories } from "@/lib/directus/categories";
import { getCities } from "@/lib/directus/cities";
import { getPromotions } from "@/lib/directus/promotions";
import { getStores } from "@/lib/directus/stores";
import { getVacancies } from "@/lib/directus/vacancies";

const readers = {
  brands: getBrands,
  cities: getCities,
  stores: getStores,
  promotions: getPromotions,
  categories: getCategories,
  vacancies: getVacancies,
} as const;

type ResourceName = keyof typeof readers;

function isResourceName(value: string): value is ResourceName {
  return value in readers;
}

export async function GET(_request: Request, context: { params: Promise<{ resource: string }> }) {
  const { resource } = await context.params;
  if (!isResourceName(resource)) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Resource not found" } }, { status: 404 });
  }

  try {
    const data = await readers[resource]();
    return NextResponse.json({ data }, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
  } catch (error) {
    console.error("Public API read failed", { resource, cause: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: { code: "UPSTREAM_UNAVAILABLE", message: "Data is temporarily unavailable" } }, { status: 503 });
  }
}
