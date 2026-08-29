import type { Metadata } from "next";
import { BrandLandingPage } from "@/components/brand/BrandLandingPage";
import { createPageMetadata } from "@/lib/seo/metadata";
export const metadata: Metadata = createPageMetadata({ title: "Вентиль в Амурске — водоснабжение и отопление", description: "Официальная страница магазина «Вентиль» в Амурске: сантехника, отопление, водоснабжение и торговая точка.", path: "/ventil/" });
export default function Page() {
  return (
    <BrandLandingPage
      slug="ventil"
      heroEyebrow="Магазин сантехники · Амурск"
      nameInPrepositional="Вентиле"
      aboutHeading="Магазин сантехники в Амурске"
    />
  );
}
