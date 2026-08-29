import type { Promotion } from "@/types/promotion";
import { EmptyState } from "@/components/ui/EmptyState";
import { PromotionCard } from "./PromotionCard";

export function PromotionList({ promotions }: { promotions: Promotion[] }) {
  if (!promotions.length) return <EmptyState title="Активных акций пока нет" text="Здесь появятся только подтверждённые предложения и условия." />;
  return <div className="card-grid">{promotions.map((promotion) => <PromotionCard key={promotion.id} promotion={promotion} />)}</div>;
}
