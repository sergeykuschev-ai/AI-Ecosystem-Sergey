import type { Metadata } from "next";
import { BrandLandingPage } from "@/components/brand/BrandLandingPage";
import { createPageMetadata } from "@/lib/seo/metadata";
export const dynamic = "force-dynamic";
export const metadata: Metadata = createPageMetadata({ title: "Метиз Маркет в Амурске — крепёж и инструмент", description: "Официальная страница Метиз Маркет в Амурске: крепёж, инструмент, расходные материалы и магазин.", path: "/metiz-market/" });
export default function Page() {
  return (
    <BrandLandingPage
      slug="metiz-market"
      heroEyebrow="Крепёж и инструмент · Амурск"
      nameInPrepositional="Метиз Маркете"
      aboutHeading="Крепёж и инструмент в Амурске"
    />
  );
}
