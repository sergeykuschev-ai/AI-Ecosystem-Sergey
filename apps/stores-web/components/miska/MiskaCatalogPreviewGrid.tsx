"use client";

import Image from "next/image";
import { useMemo, useState } from "react";

export interface PreviewProduct {
  externalId: string;
  name: string;
  sourceName: string;
  sku: string | null;
  barcode: string | null;
  price: number | string | null;
  stockQuantity: number | string | null;
  groupId: string;
  groupName: string;
  categoryName: string;
  subcategoryName: string | null;
  brand: string | null;
  classificationStatus: string | null;
  classificationConfidence: number | null;
  contentStatus: string | null;
  imageId: string | null;
  description: string | null;
}

interface Props {
  products: PreviewProduct[];
  groups: Array<{ id: string; name: string; count: number }>;
  brands: Array<{ name: string; count: number }>;
}
const rub = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 2,
});

function numeric(value: number | string | null) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

export function MiskaCatalogPreviewGrid({ products, groups, brands }: Props) {
  const [query, setQuery] = useState("");
  const [availability, setAvailability] = useState("all");
  const [group, setGroup] = useState("all");
  const [brand, setBrand] = useState("all");
  const [sort, setSort] = useState("available");
  const [visible, setVisible] = useState(96);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru-RU");
    const result = products.filter((product) => {
      const stock = numeric(product.stockQuantity);
      const matchesQuery = !needle || [product.name, product.sourceName, product.sku, product.barcode, product.brand]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase("ru-RU").includes(needle));
      const matchesGroup = group === "all" || product.groupId === group;
      const matchesBrand = brand === "all" || product.brand === brand;
      const matchesAvailability =
        availability === "all" ||
        (availability === "in-stock" && stock > 0) ||
        (availability === "out-of-stock" && stock <= 0) ||
        (availability === "no-price" && product.price == null);
      return matchesQuery && matchesGroup && matchesBrand && matchesAvailability;
    });

    return result.sort((left, right) => {
      if (sort === "price-asc") return numeric(left.price) - numeric(right.price);
      if (sort === "price-desc") return numeric(right.price) - numeric(left.price);
      if (sort === "name") return left.name.localeCompare(right.name, "ru");
      const stockDifference = Number(numeric(right.stockQuantity) > 0) - Number(numeric(left.stockQuantity) > 0);
      return stockDifference || left.name.localeCompare(right.name, "ru");
    });
  }, [availability, brand, group, products, query, sort]);

  const resetVisible = () => setVisible(96);
  const inStock = filtered.filter((product) => numeric(product.stockQuantity) > 0).length;

  return (
    <div className="miska-catalog-browser">
      <button
        type="button"
        className="miska-catalog-filter-toggle"
        aria-expanded={filtersOpen}
        onClick={() => setFiltersOpen((value) => !value)}
      >
        {filtersOpen ? "Скрыть фильтры" : "Фильтры и сортировка"}
      </button>
      <div className={`miska-catalog-toolbar${filtersOpen ? " miska-catalog-toolbar--open" : ""}`}>
        <label className="miska-catalog-search">
          <span>Поиск</span>
          <input
            type="search"
            value={query}
            placeholder="Название, артикул или штрихкод"
            onChange={(event) => { setQuery(event.target.value); resetVisible(); }}
          />
        </label>

        {groups.length > 1 ? (
          <label>
            <span>Категория</span>
            <select value={group} onChange={(event) => { setGroup(event.target.value); resetVisible(); }}>
              <option value="all">Все категории</option>
              {groups.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.count}</option>)}
            </select>
          </label>
        ) : null}
        {brands.length ? (
          <label>
            <span>Бренд</span>
            <select value={brand} onChange={(event) => { setBrand(event.target.value); resetVisible(); }}>
              <option value="all">Все бренды</option>
              {brands.map((item) => <option key={item.name} value={item.name}>{item.name} · {item.count}</option>)}
            </select>
          </label>
        ) : null}
        <label>
          <span>Наличие</span>
          <select value={availability} onChange={(event) => { setAvailability(event.target.value); resetVisible(); }}>
            <option value="all">Все товары</option>
            <option value="in-stock">В наличии</option>
            <option value="out-of-stock">Нет в наличии</option>
            <option value="no-price">Без цены</option>
          </select>
        </label>
        <label>
          <span>Сортировка</span>
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="available">Сначала в наличии</option>
            <option value="name">По названию</option>
            <option value="price-asc">Цена по возрастанию</option>
            <option value="price-desc">Цена по убыванию</option>
          </select>
        </label>
      </div>

      <div className="miska-catalog-results">
        <strong>{filtered.length} товаров</strong>
        <span>· {inStock} в наличии</span>
      </div>

      <div className="miska-product-grid">
        {filtered.slice(0, visible).map((product) => {
          const stock = numeric(product.stockQuantity);
          return (
            <article className="miska-product-card" key={product.externalId}>
              <div className={product.imageId ? "miska-product-card__image" : "miska-product-card__image miska-product-card__image--empty"}>
                {product.imageId ? (
                  <Image
                    src={`/api/assets/${product.imageId}`}
                    alt={product.name}
                    width={420}
                    height={420}
                    sizes="(max-width: 719px) 100vw, (max-width: 1079px) 50vw, 33vw"
                  />
                ) : <span aria-hidden="true">Фото готовим</span>}
              </div>
              <div className="miska-product-card__body">
                <p className="miska-product-card__category">
                  {product.categoryName}{product.subcategoryName ? ` · ${product.subcategoryName}` : ""}
                </p>
                <h2>{product.name}</h2>
                {product.brand ? <p className="miska-product-card__brand">{product.brand}</p> : null}
                {product.classificationStatus === "review" ? (
                  <p className="miska-product-card__review">Нужна проверка категории</p>
                ) : null}
                {product.contentStatus === "review" ? (
                  <p className="miska-product-card__review">Нужна проверка контента</p>
                ) : null}
                {product.contentStatus === "review" ? (
                  <p className="miska-product-card__review">Нужна проверка контента</p>
                ) : null}
                {product.description ? <p className="miska-product-card__description">{product.description}</p> : null}
                <div className="miska-product-card__codes">
                  {product.sku ? <span>Арт. {product.sku}</span> : null}
                  {product.barcode ? <span>{product.barcode}</span> : null}
                </div>
                <div className="miska-product-card__bottom">
                  <strong className="miska-product-card__price">
                    {product.price == null ? "Цена не задана" : rub.format(numeric(product.price))}
                  </strong>
                  <span className={stock > 0 ? "stock-badge stock-badge--yes" : "stock-badge"}>
                    {stock > 0 ? `В наличии · ${stock}` : "Нет в наличии"}
                  </span>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="miska-catalog-empty">По этим условиям товаров не найдено.</div>
      ) : null}

      {visible < filtered.length ? (
        <div className="miska-catalog-more">
          <button type="button" onClick={() => setVisible((value) => value + 96)}>
            Показать ещё {Math.min(96, filtered.length - visible)}
          </button>
        </div>
      ) : null}
    </div>
  );
}
