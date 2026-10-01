import type { Category } from "@/types/category";
import { CategoryCard } from "./CategoryCard";
import { getStoreCategoryHref } from "@/lib/seo/store-category-links";

interface CategoryGridProps {
  categories: Category[];
  variant?: "default" | "brand-landing";
  extraItems?: string[];
  storeBrandSlug?: string;
}

export function CategoryGrid({ categories, variant = "default", extraItems, storeBrandSlug }: CategoryGridProps) {
  const className = variant === "brand-landing"
    ? "category-grid category-grid--brand-landing"
    : "category-grid";

  return (
    <ul className={className}>
      {categories.map((category) => <CategoryCard key={category.id} category={category} href={storeBrandSlug ? getStoreCategoryHref(storeBrandSlug, category.name) : undefined} />)}
      {extraItems?.map((item) => <li className="category-card" key={item}>{item}</li>)}
    </ul>
  );
}
