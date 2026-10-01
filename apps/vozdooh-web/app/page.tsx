import Link from "next/link";
import type { Metadata } from "next";
import { SITE_NAME } from "@/lib/site";
import { getPublicBrands } from "@/lib/brands/public";

export const metadata: Metadata = {
  title: "Главная",
};

export default function HomePage() {
  const brands = getPublicBrands();
  return (
    <main className="home">
      <h1>{SITE_NAME}</h1>
      <p>Магазин ароматов для дома.</p>
      <p>
        <Link href="/brands">Бренды</Link>
        {brands.length > 0 ? ` — ${brands.length} в каталоге` : null}
      </p>
    </main>
  );
}
