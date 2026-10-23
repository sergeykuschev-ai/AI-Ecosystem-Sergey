import type { Metadata } from 'next'
import Link from 'next/link'
import { InfoPage } from '../../components/InfoPage'
import { publicRobots } from '../../src/seo/indexing'

export const metadata: Metadata = {
  title: 'Ароматы для бизнеса и корпоративные подарки в Хабаровске — VOZDOOH',
  description: 'Интерьерные ароматы и корпоративные подарки в Хабаровске: VOZDOOH для дизайнеров, отелей, SPA, салонов, ресторанов и компаний. Подбор из актуального наличия.',
  alternates: { canonical: '/business' },
  robots: publicRobots(),
}

export default function BusinessPage() {
  return (
    <InfoPage
      eyebrow="VOZDOOH для бизнеса"
      title="Аромат как часть пространства и подарка"
      lead="VOZDOOH в Хабаровске: подбираем интерьерную парфюмерию для проектов, гостевых пространств и корпоративных подарков из ассортимента, который реально есть в наличии."
    >
      <section className="infoSection">
        <h2>Кому подойдёт</h2>
        <dl className="infoFacts">
          <div><dt>Дизайнерам и декораторам</dt><dd>Аромат как финальный штрих жилого или общественного интерьера.</dd></div>
          <div><dt>Отелям, салонам и SPA</dt><dd>Диффузоры, свечи и спреи для гостевых и общих зон.</dd></div>
          <div><dt>Ресторанам и бутикам</dt><dd>Интерьерные ароматы для атмосферы и подарочных сценариев.</dd></div>
          <div><dt>Компаниям</dt><dd>Подарки клиентам, партнёрам и сотрудникам с подбором под бюджет и повод.</dd></div>
        </dl>
      </section>

      <section className="infoSection">
        <h2>Корпоративные подарки и ароматы для бизнеса в Хабаровске</h2>
        <p>Для компаний можем собрать подарочные решения для клиентов, партнёров и сотрудников. Для дизайнеров, отелей, SPA, салонов и других пространств — подобрать диффузоры, свечи и спреи под характер интерьера и задачу.</p>
        <p>Начинаем с бюджета, количества и сценария использования, а затем предлагаем варианты из фактического наличия — без обещаний товара, которого нет на складе.</p>
      </section>

      <section className="infoSection">
        <h2>Что можно подобрать сейчас</h2>
        <p>Мы не предлагаем абстрактный каталог «под заказ»: начинаем с актуального склада VOZDOOH. Можно подобрать формат, аромат и бюджет, а затем проверить фактическое наличие перед подтверждением.</p>
        <p><Link className="textLink" href="/collections/home-fragrance">Ароматы для дома →</Link></p>
        <p><Link className="textLink" href="/collections/gift-diffusers">Диффузоры в подарок →</Link></p>
        <p><Link className="textLink" href="/brands/culti-milano">CULTI MILANO →</Link></p>
        <p><Link className="textLink" href="/brands/teatro-fragranze-uniche">TEATRO Fragranze Uniche →</Link></p>
      </section>

      <section className="infoSection">
        <h2>Обсудить задачу</h2>
        <p>Напишите, для какого пространства или подарочного проекта нужен аромат, сколько получателей или помещений и какой ориентир по бюджету. Мы соберём варианты из текущего наличия.</p>
        <dl className="infoFacts">
          <div>
            <dt>Телефон</dt>
            <dd><a className="textLink" href="tel:+79244199990">+7 924 419-99-90</a></dd>
          </div>
          <div>
            <dt>Электронная почта</dt>
            <dd><a className="textLink" href="mailto:vozdooh.kms@yandex.ru?subject=VOZDOOH%20для%20бизнеса">vozdooh.kms@yandex.ru</a></dd>
          </div>
        </dl>
      </section>
    </InfoPage>
  )
}
