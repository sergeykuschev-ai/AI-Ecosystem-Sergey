import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { StaticPage } from "@/components/content/StaticPage";
import { createPageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = createPageMetadata({
  title: "Аудиореклама в магазинах Амурска | Ампер, Вентиль, Метиз Маркет, Миска",
  description:
    "Размещение аудиорекламы сразу в четырёх магазинах Амурска: Ампер, Вентиль, Метиз Маркет и Миска. Пакеты 5, 10 и 20 выходов в день.",
  path: "/reklama/",
});

const tariffs = [
  {
    name: "Старт",
    plays: "5 выходов в день",
    frequency: "примерно раз в 2 часа",
    price: "3 000 ₽",
  },
  {
    name: "Оптимум",
    plays: "10 выходов в день",
    frequency: "примерно раз в час",
    price: "5 000 ₽",
    featured: true,
  },
  {
    name: "Максимум",
    plays: "20 выходов в день",
    frequency: "примерно раз в 30 минут",
    price: "8 000 ₽",
  },
];

const stores = ["Ампер", "Вентиль", "Метиз Маркет", "Миска"];

export default function AdvertisingPage() {
  return (
    <div className="advertising-page">
      <StaticPage
        eyebrow="Для бизнеса"
        title="Аудиореклама в четырёх магазинах Амурска"
        intro="Ваш короткий аудиоролик звучит в торговых залах «Ампера», «Вентиля», «Метиз Маркета» и «Миски» — там, где покупатели уже выбирают товары и услуги."
        breadcrumbs={
          <Breadcrumbs
            trail={[
              { name: "Главная", path: "/" },
              { name: "Реклама в магазинах", path: "/reklama/" },
            ]}
          />
        }
      >
        <section className="advertising-section advertising-network" aria-labelledby="advertising-network-title">
          <p className="eyebrow">Одна заявка — четыре площадки</p>
          <h2 id="advertising-network-title">Размещение сразу во всей сети</h2>
          <p>
            Все четыре магазина находятся в Амурске по адресу проспект Победы, 16. В тариф входит
            размещение ролика во всех четырёх торговых залах.
          </p>
          <ul className="advertising-store-list" aria-label="Магазины, участвующие в размещении">
            {stores.map((store) => (
              <li key={store}>{store}</li>
            ))}
          </ul>
        </section>

        <section className="advertising-section" aria-labelledby="advertising-tariffs-title">
          <p className="eyebrow">Тарифы</p>
          <h2 id="advertising-tariffs-title">Выберите частоту выходов</h2>
          <div className="advertising-tariff-grid">
            {tariffs.map((tariff) => (
              <article
                className={`advertising-tariff${tariff.featured ? " advertising-tariff--featured" : ""}`}
                key={tariff.name}
              >
                {tariff.featured ? <span className="advertising-tariff__badge">Рекомендуем</span> : null}
                <h3>{tariff.name}</h3>
                <p className="advertising-tariff__plays">{tariff.plays}</p>
                <p className="advertising-tariff__frequency">{tariff.frequency}</p>
                <p className="advertising-tariff__price">
                  <strong>{tariff.price}</strong>
                  <span> / 30 дней</span>
                </p>
                <p className="advertising-tariff__note">Во всех 4 магазинах</p>
              </article>
            ))}
          </div>
          <p className="advertising-fineprint">
            Базовый тариф рассчитан на ролик длительностью до 20 секунд. Более длинный формат и
            нестандартное расписание согласовываются отдельно.
          </p>
        </section>

        <section className="advertising-section advertising-production" aria-labelledby="advertising-production-title">
          <div>
            <p className="eyebrow">Нет готового ролика?</p>
            <h2 id="advertising-production-title">Поможем подготовить аудиоролик</h2>
            <p>
              Вы можете предоставить готовый файл или заказать запись. Производство стандартного
              аудиоролика — <strong>от 3 500 ₽</strong>.
            </p>
          </div>
          <div className="advertising-production__spec">
            <strong>Рекомендуемый формат</strong>
            <span>15–20 секунд</span>
            <span>MP3 или WAV</span>
          </div>
        </section>

        <section className="advertising-section" aria-labelledby="advertising-how-title">
          <p className="eyebrow">Как начать</p>
          <h2 id="advertising-how-title">Четыре шага до размещения</h2>
          <ol className="advertising-steps">
            <li><strong>Выберите тариф.</strong> 5, 10 или 20 выходов в день.</li>
            <li><strong>Передайте ролик или текст.</strong> Готовый файл либо материал для записи.</li>
            <li><strong>Согласуем содержание и даты.</strong> Проверим ролик и расписание размещения.</li>
            <li><strong>Запускаем рекламу.</strong> Ролик выходит во всех четырёх магазинах.</li>
          </ol>
        </section>

        <section className="advertising-section advertising-rules" aria-labelledby="advertising-rules-title">
          <h2 id="advertising-rules-title">Что важно знать</h2>
          <ul>
            <li>Содержание рекламы проходит предварительную проверку перед размещением.</li>
            <li>Рекламодатель отвечает за достоверность информации и права на переданные материалы.</li>
            <li>Для регулируемых категорий товаров и услуг могут потребоваться дополнительные документы или отказ в размещении.</li>
            <li>Фактический охват аудитории не заявляется без подтверждённых данных посещаемости.</li>
          </ul>
        </section>

        <section className="advertising-cta" aria-labelledby="advertising-cta-title">
          <div>
            <p className="eyebrow">Размещение в Амурске</p>
            <h2 id="advertising-cta-title">Хотите запустить ролик?</h2>
            <p>Свяжитесь с нами и сообщите, что вас интересует аудиореклама в магазинах.</p>
          </div>
          <Link className="button button--primary" href="/kontakty/">
            Контакты для размещения
          </Link>
        </section>
      </StaticPage>
    </div>
  );
}
