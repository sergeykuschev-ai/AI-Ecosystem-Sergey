import type { FAQ } from "@/types/faq";
import { FAQItem } from "./FAQItem";

export function FAQList({ items }: { items: FAQ[] }) {
  return <div className="faq-list">{items.map((item) => <FAQItem key={item.id} item={item} />)}</div>;
}
