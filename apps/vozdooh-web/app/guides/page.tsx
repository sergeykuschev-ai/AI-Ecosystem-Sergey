import type { Metadata } from 'next'
import Link from 'next/link'
import { publicRobots } from '../../src/seo/indexing'
import { SiteHeader } from '../../components/SiteHeader'
import { SiteFooter } from '../../components/SiteFooter'

export const metadata: Metadata = {
  title: 'Гиды по ароматам для дома — VOZDOOH',
  description: 'Практические гиды VOZDOOH: как выбрать аромадиффузор, подобрать аромат для комнаты и разобраться в форматах интерьерной парфюмерии.',
  alternates: { canonical: '/guides' },
  robots: publicRobots(),
}

export default function GuidesPage() {
  return (
    <main className="catalogPage">
      <SiteHeader />
      <section className="pageIntro">
        <span className="eyebrow">Гиды VOZDOOH</span>
        <h1>Как выбирать ароматы для дома</h1>
        <p>Короткие практические материалы о диффузорах, свечах и выборе аромата — без универсальных обещаний там, где всё зависит от конкретного продукта и пространства.</p>
      </section>

      <section className="landingGuide" aria-labelledby="guide-diffuser">
        <span className="eyebrow">Выбор</span>
        <h2 id="guide-diffuser">Как выбрать аромадиффузор для дома</h2>
        <p>Разбираем выбор по комнате, характеру композиции, интенсивности, объёму и подарочному сценарию.</p>
        <Link className="textLink" href="/guides/kak-vybrat-aromadiffuzor">Читать гид →</Link>
      </section>

      <section className="landingGuide" aria-labelledby="guide-gift">
        <span className="eyebrow">Подарок</span>
        <h2 id="guide-gift">Аромадиффузор в подарок: как выбрать</h2>
        <p>Что делать, если вкусы человека известны не полностью: как сузить направление, выбрать формат и не придумывать «универсальный аромат».</p>
        <Link className="textLink" href="/guides/aromadiffuzor-v-podarok">Читать гид →</Link>
      </section>

      <section className="landingGuide" aria-labelledby="guide-rooms">
        <span className="eyebrow">По пространству</span>
        <h2 id="guide-rooms">Как выбрать аромат для гостиной и спальни</h2>
        <p>Как различается сценарий выбора для общей зоны и личного пространства, и какие позиции из актуального наличия подходят под уже размеченные коллекции VOZDOOH.</p>
        <Link className="textLink" href="/guides/aromat-dlya-gostinoy-i-spalni">Читать гид →</Link>
      </section>

      <SiteFooter />
    </main>
  )
}
