import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { JsonLd } from "@/components/seo/JsonLd";
import { LocalStoreNetworkLinks } from "@/components/seo/LocalStoreNetworkLinks";
import { BrandStoreContact } from "@/components/stores/BrandStoreContact";
import { Container } from "@/components/ui/Container";
import {
  VENTIL_SEO_CATEGORIES,
  type VentilSeoCategory,
} from "@/lib/ventil/seo-categories";
import { getBrandBySlug } from "@/lib/directus/brands";
import { getCities } from "@/lib/directus/cities";
import { getStoresByBrand } from "@/lib/directus/stores";
import {
  createOrganizationsJsonLd,
  createStoreJsonLd,
} from "@/lib/seo/json-ld";

interface VentilSeoCategoryPageProps {
  category: VentilSeoCategory;
}

export async function VentilSeoCategoryPage({ category }: VentilSeoCategoryPageProps) {
  const brand = await getBrandBySlug("ventil");
  if (!brand) notFound();

  const [stores, cities] = await Promise.all([
    getStoresByBrand(brand.id),
    getCities(),
  ]);
  const store = stores[0];
  const city = cities.find((item) => item.id === store?.city_id);
  const relatedCategories = VENTIL_SEO_CATEGORIES.filter(
    (item) => item.slug !== category.slug,
  );
  const path = `/ventil/${category.slug}/`;

  return (
    <main
      className="brand-landing"
      data-brand="ventil"
      style={{ "--brand-color": brand.primary_color } as React.CSSProperties}
    >
      <JsonLd data={createOrganizationsJsonLd([brand])} />
      {store && city ? <JsonLd data={createStoreJsonLd(store, brand, city)} /> : null}
      <Container>
        <Breadcrumbs
          trail={[
            { name: "Главная", path: "/" },
            { name: "Вентиль", path: "/ventil/" },
            { name: category.label, path },
          ]}
        />

        <header className="brand-landing-hero">
          <div className="brand-landing-hero__logo">
            <BrandLogo brand={brand} />
          </div>
          <div className="brand-landing-hero__content">
            <p className="eyebrow">Вентиль · {category.label}</p>
            <h1>{category.h1}</h1>
            <p className="lead">{category.lead}</p>
            <div className="button-row">
              <Link className="button button--primary" href="/ventil/">
                Все сантехника
              </Link>
              <Link className="button button--secondary" href="/kontakty/">
                Адрес и контакты
              </Link>
            </div>
          </div>
        </header>

        <section className="brand-landing-section" aria-labelledby="category-overview">
          <p className="eyebrow">Подбор</p>
          <h2 id="category-overview">{category.overviewHeading}</h2>
          <p>{category.overview}</p>
          <div className="ventil-feature-grid">
            {category.items.map((item) => (
              <article className="ventil-feature-card" key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section
          className="brand-landing-section brand-landing-section--compact"
          aria-labelledby="category-selection"
        >
          <div className="ventil-assist-panel">
            <h2 id="category-selection">{category.selectionHeading}</h2>
            <ul className="ventil-assist-list">
              {category.selectionTips.map((tip) => (
                <li key={tip}>{tip}</li>
              ))}
            </ul>
            <p className="ventil-assist-note">{category.note}</p>
          </div>
        </section>

        <section className="brand-landing-section" aria-labelledby="ventil-related-categories">
          <p className="eyebrow">Другие направления</p>
          <h2 id="ventil-related-categories">Другие разделы магазина «Вентиль»</h2>
          <div className="ventil-feature-grid">
            {relatedCategories.map((item) => {
              const href = `/ventil/${item.slug}/`;
              return (
                <article className="ventil-feature-card" key={item.slug}>
                  <h3>
                    <Link href={href}>{item.label}</Link>
                  </h3>
                  <p>{item.lead}</p>
                </article>
              );
            })}
          </div>
        </section>

        <LocalStoreNetworkLinks currentSlug="ventil" />

        {store && city ? (
          <section
            className="brand-landing-section brand-landing-section--contact"
            aria-label={`Контакты магазина ${brand.name}`}
          >
            <BrandStoreContact
              store={store}
              brand={brand}
              city={city}
              heading="Вентиль в Амурске"
              note={`Уточнить наличие товаров раздела «${category.label}» можно в магазине «Вентиль».`}
              showCallAction
              contactsHref="/kontakty/"
            />
          </section>
        ) : null}
      </Container>
    </main>
  );
}
