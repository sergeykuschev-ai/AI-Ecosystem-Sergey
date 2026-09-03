import type { Category } from "@/types/category";
import { CategoryCard } from "./CategoryCard";

interface CategoryGridProps {
  categories: Category[];
  variant?: "default" | "brand-landing";
  extraItems?: string[];
}

export function CategoryGrid({ categories, variant = "default", extraItems }: CategoryGridProps) {
  const className = variant === "brand-landing"
    ? "category-grid category-grid--brand-landing"
    : "category-grid";

  return (
    <ul className={className}>
      {categories.map((category) => <CategoryCard key={category.id} category={category} />)}
      {extraItems?.map((item) => <li className="category-card" key={item}>{item}</li>)}
    </ul>
  );
}
