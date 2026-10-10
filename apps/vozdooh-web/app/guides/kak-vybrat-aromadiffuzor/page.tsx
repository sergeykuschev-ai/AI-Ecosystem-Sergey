import type { Metadata } from 'next'
import Link from 'next/link'
import { publicRobots } from '../../../src/seo/indexing'
import { SiteHeader } from '../../../components/SiteHeader'
import { SiteFooter } from '../../../components/SiteFooter'

export const metadata: Metadata = {
  title: 'Как выбрать аромадиффузор для дома — гид VOZDOOH',
  description: 'Как выбрать аромадиффузор для дома: по комнате, характеру аромата, интенсивности, объёму и подарочному сценарию. Практический гид VOZDOOH.',
  alternates: { canonical: '/guides/kak-vybrat-aromadiffuzor' },
  robots: publicRobots(),
}

const structuredData = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'Как выбрать аромадиффузор для дома',
  description: 'Практический гид VOZDOOH по выбору аромадиффузора для дома.',
  mainEntityOfPage: 'https://vozdooh27.ru/guides/kak-vybrat-aromadiffuzor',
  author: { '@type': 'Organization', name: 'VOZDOOH', url: 'https://vozdooh27.ru' },
  publisher: { '@type': 'Organization', name: 'VOZDOOH', url: 'https://vozdooh27.ru' },
  inLanguage: 'ru-RU',
}).replace(/</g, '\\u003c')

export default function DiffuserGuidePage() {
  return (
    <main className="catalogPage">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData }} />
      <SiteHeader />

      <article>
        <section className="pageIntro">
          <nav className="landingLinks" aria-label="Навигация">
            <Link href="/guides">Гиды</Link>
            <Link href="/categories/diffusers">Аромадиффузоры</Link>
          </nav>
          <span className="eyebrow">Практический гид</span>
          <h1>Как выбрать аромадиффузор для дома</h1>
          <p>Хороший выбор начинается не со списка нот, а с пространства и того, как вы хотите ощущать его каждый день. Ниже — простой порядок, который помогает сузить выбор без лишней парфюмерной терминологии.</p>
        </section>

        <section className="landingGuide">
          <h2>1. Начните с комнаты</h2>
          <p>Один и тот же аромат может восприниматься по-разному в небольшой спальне, открытой гостиной или кабинете. Для спокойных пространств обычно удобнее начинать с более мягких и чистых направлений, а гостиная или кабинет позволяют выбирать более выразительные древесные, пряные и насыщенные композиции.</p>
          <nav className="landingLinks" aria-label="Подбор по комнате">
            <Link href="/collections/bedroom">Для спальни</Link>
            <Link href="/collections/living-room">Для гостиной</Link>
            <Link href="/finder">Подобрать аромат</Link>
          </nav>
        </section>

        <section className="landingGuide">
          <h2>2. Выберите характер, а не только красивые ноты</h2>
          <p>Если вы уже знаете, что вам ближе свежесть, дерево, цветы или тёплые композиции, начинайте с этого. Так проще сравнивать ароматы разных брендов и не выбирать только по знакомому ингредиенту в описании.</p>
          <nav className="landingLinks" aria-label="Подбор по характеру">
            <Link href="/collections/fresh-air">Свежие</Link>
            <Link href="/collections/woods-and-spices">Древесные и пряные</Link>
            <Link href="/collections/floral">Цветочные</Link>
            <Link href="/collections/warm-interior">Тёплые</Link>
          </nav>
        </section>

        <section className="landingGuide">
          <h2>3. Не судите об интенсивности только по объёму</h2>
          <p>Больший флакон обычно рассчитан на более длительное использование, но сила аромата зависит не только от миллилитров. На ощущение влияют сама композиция, количество и материал палочек, движение воздуха, температура и место установки. Поэтому универсальная формула «объём = площадь комнаты» работает слишком грубо.</p>
          <p>Для конкретного диффузора ориентируйтесь на инструкцию бренда. Если аромат можно регулировать количеством палочек, разумнее начать мягче и увеличивать интенсивность постепенно.</p>
        </section>

        <section className="landingGuide">
          <h2>4. Для подарка выбирайте понятный сценарий</h2>
          <p>Если вкусы человека неизвестны, проще начать с универсального формата и не самого полярного ароматического направления. Если вы хорошо знаете предпочтения получателя, можно выбирать более характерные ванильные, пряные, кожаные или удовые композиции.</p>
          <p>Важно смотреть не только на запах, но и на флакон, объём и комплектацию: у интерьерного подарка внешний вид работает вместе с ароматом.</p>
          <Link className="textLink" href="/collections/gift-diffusers">Аромадиффузоры в подарок →</Link>
        </section>

        <section className="landingGuide">
          <h2>5. Проверьте место установки</h2>
          <p>Ставьте диффузор на устойчивую поверхность и учитывайте рекомендации производителя. Прямое солнце, источники тепла и сильный постоянный поток воздуха могут менять скорость испарения. Ароматическую жидкость важно держать вдали от детей и животных и не допускать её попадания на чувствительные поверхности.</p>
        </section>

        <section className="landingGuide">
          <h2>Короткий порядок выбора</h2>
          <p>Комната → характер аромата → желаемая интенсивность → формат и объём → дизайн флакона → конкретная позиция в наличии. Такой порядок обычно быстрее, чем сравнивать десятки описаний по отдельным нотам.</p>
          <nav className="landingLinks" aria-label="Перейти к выбору">
            <Link href="/categories/diffusers">Все аромадиффузоры</Link>
            <Link href="/collections/home-fragrance">Все ароматы для дома</Link>
            <Link href="/delivery">Доставка</Link>
          </nav>
        </section>

        <section className="landingGuide" aria-labelledby="faq-title">
          <h2 id="faq-title">Частые вопросы</h2>
          <h3>Какой диффузор выбрать для спальни?</h3>
          <p>Если вы не знаете свою комфортную интенсивность, начните с более спокойной композиции и регулируйте её по инструкции конкретного диффузора. Для выбора по уже размеченным ароматам VOZDOOH есть отдельная подборка для спальни.</p>
          <h3>Сколько палочек ставить в диффузор?</h3>
          <p>Единого числа для всех брендов нет. Диаметр палочек, формула жидкости и конструкция флакона отличаются. Сначала используйте рекомендацию производителя; если бренд допускает регулировку количеством палочек, меняйте интенсивность постепенно.</p>
          <h3>Можно ли дарить аромадиффузор, если не знаешь любимый аромат?</h3>
          <p>Да, но лучше выбирать не самый сложный аромат и обращать внимание на оформление. Если есть возможность, выясните хотя бы общее предпочтение: свежие, цитрусовые, древесные, цветочные или тёплые композиции.</p>
        </section>
      </article>

      <SiteFooter />
    </main>
  )
}
