import type { Metadata } from "next";
import { BrandLandingPage } from "@/components/brand/BrandLandingPage";
import { createPageMetadata } from "@/lib/seo/metadata";
export const dynamic = "force-dynamic";
export const metadata: Metadata = createPageMetadata({ title: "Ампер в Амурске — электротовары и электромонтаж", description: "Официальная страница магазина «Ампер» в Амурске: направления и информация о торговой точке.", path: "/amper/" });
export default function Page() {
  return (
    <BrandLandingPage
      slug="amper"
      heroEyebrow="Магазин электротоваров · Амурск"
      nameInPrepositional="Ампере"
      aboutHeading="Магазин электротоваров в Амурске"
    />
  );
}
