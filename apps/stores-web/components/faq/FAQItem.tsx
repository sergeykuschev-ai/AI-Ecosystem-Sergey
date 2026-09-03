import type { FAQ } from "@/types/faq";

export function FAQItem({ item }: { item: FAQ }) {
  const paragraphs = item.answer.split("\n").filter((line) => line.trim().length > 0);
  return (
    <details className="faq-item">
      <summary>
        <span>{item.question}</span>
        <span className="faq-item__indicator" aria-hidden="true" />
      </summary>
      <div className="faq-item__body">
        {paragraphs.map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </div>
    </details>
  );
}
