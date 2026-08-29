import type { Promotion } from "@/types/promotion";

export function PromotionCard({ promotion }: { promotion: Promotion }) {
  return (
    <article className="card">
      <h3>{promotion.title}</h3>
      <p>{promotion.short_description}</p>
      {promotion.terms && <p><small>{promotion.terms}</small></p>}
    </article>
  );
}
