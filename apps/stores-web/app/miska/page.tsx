import type { Metadata } from "next";
import { BrandLandingPage } from "@/components/brand/BrandLandingPage";
import { createPageMetadata } from "@/lib/seo/metadata";
export const metadata: Metadata = createPageMetadata({ title: "Миска в Амурске — товары для питомцев", description: "Официальная страница магазина «Миска» в Амурске: направления товаров для домашних животных и торговая точка.", path: "/miska/" });
export default function Page() {
  return (
    <BrandLandingPage
      slug="miska"
      heroEyebrow="Зоомагазин · Амурск"
      nameInPrepositional="Миске"
      aboutHeading="Зоомагазин в Амурске"
    />
  );
}
