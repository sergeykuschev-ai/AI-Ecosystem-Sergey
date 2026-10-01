import type { Category } from "@/types/category";
import Link from "next/link";

export function CategoryCard({ category, href }: { category: Category; href?: string }) {
  return <li className="category-card">{href ? <Link href={href}>{category.name}</Link> : category.name}</li>;
}
