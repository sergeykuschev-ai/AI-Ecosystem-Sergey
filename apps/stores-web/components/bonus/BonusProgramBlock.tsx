import {
  BONUS_CARD_THRESHOLDS_RUB,
  BONUS_EARN_RATE,
  BONUS_SPEND_CAP_PERCENT,
  BONUS_VALIDITY_LABEL,
  formatRubles,
} from "@/lib/constants/bonus";
import type { BonusProgram } from "@/types/bonus-program";

const CARD_THRESHOLDS = [
  { stores: "Ампер, Вентиль и Метиз Маркет", amount: BONUS_CARD_THRESHOLDS_RUB.amper },
  { stores: "Миска", amount: BONUS_CARD_THRESHOLDS_RUB.miska },
];

export function BonusProgramBlock({ program }: { program: BonusProgram }) {
  const earnRate = program.rules[0] ?? BONUS_EARN_RATE;
  const spendRate = program.rules[1] ?? `${BONUS_SPEND_CAP_PERCENT}%`;
  const validity = program.rules[2] ?? BONUS_VALIDITY_LABEL;

  return (
    <div className="bonus-program">
      <h2>Как это работает</h2>
      <div className="card-grid">
        <article className="card">
          <h3>Получайте {earnRate}</h3>
          <p>С каждой покупки начисляется {earnRate} бонусами.</p>
        </article>
        <article className="card">
          <h3>Используйте бонусы</h3>
          <p>Бонусами можно оплатить до {spendRate} суммы покупки.</p>
        </article>
        <article className="card">
          <h3>Не откладывайте</h3>
          <p>Начисленные бонусы действуют {validity}.</p>
        </article>
      </div>

      <div className="feature-panel">
        <h2>Одна программа для наших магазинов</h2>
        <p>Бонусная программа действует во всех магазинах сети. Накапливайте бонусы в одном месте и используйте их при следующих покупках.</p>
      </div>

      <div className="feature-panel">
        <h2>Как получить бонусную карту</h2>
        <div className="card-grid">
          {CARD_THRESHOLDS.map((item) => (
            <article className="card" key={item.stores}>
              <h3>{item.stores}</h3>
              <p>Карта выдаётся при покупке от {formatRubles(item.amount)}.</p>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
