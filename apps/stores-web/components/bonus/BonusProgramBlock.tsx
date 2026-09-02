import type { BonusProgram } from "@/types/bonus-program";

const CARD_THRESHOLDS = [
  { stores: "Ампер, Вентиль и Метиз Маркет", amount: "3 500 ₽" },
  { stores: "Миска", amount: "2 000 ₽" },
];

export function BonusProgramBlock({ program }: { program: BonusProgram }) {
  const earnRate = program.rules[0] ?? "5%";
  const spendRate = program.rules[1] ?? "15%";
  const validity = program.rules[2] ?? "3 месяца";

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
              <p>Карта выдаётся при покупке от {item.amount}.</p>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
