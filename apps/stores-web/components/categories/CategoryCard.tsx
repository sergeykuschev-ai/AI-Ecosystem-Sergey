import type { Category } from "@/types/category";

export function CategoryCard({ category }: { category: Category }) {
  return <li className="category-card">{category.name}</li>;
}
