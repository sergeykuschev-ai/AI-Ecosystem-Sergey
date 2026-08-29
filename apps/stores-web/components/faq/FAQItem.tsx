import type { FAQ } from "@/types/faq";

export function FAQItem({ item }: { item: FAQ }) {
  return <details className="faq-item"><summary>{item.question}</summary><p>{item.answer}</p></details>;
}
