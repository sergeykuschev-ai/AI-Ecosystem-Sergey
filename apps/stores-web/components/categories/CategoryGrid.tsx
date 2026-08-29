import type { Category } from "@/types/category";
import { CategoryCard } from "./CategoryCard";

interface CategoryGridProps {
  categories: Category[];
  variant?: "default" | "brand-landing";
}

export function CategoryGrid({ categories, variant = "default" }: CategoryGridProps) {
  const className = variant === "brand-landing"
    ? "category-grid category-grid--brand-landing"
    : "category-grid";

  return <ul className={className}>{categories.map((category) => <CategoryCard key={category.id} category={category} />)}</ul>;
}
