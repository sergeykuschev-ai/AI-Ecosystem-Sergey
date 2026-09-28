import Link from 'next/link'
import { SiteFooter } from './SiteFooter'
import { SiteHeader } from './SiteHeader'

/** Shared editorial shell for customer information pages. */
export function InfoPage({ eyebrow, title, lead, children }: {
  eyebrow: string
  title: string
  lead?: string
  children: React.ReactNode
}) {
  return (
    <main className="infoPage">
      <SiteHeader />
      <section className="infoHero">
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {lead && <p className="infoLead">{lead}</p>}
      </section>
      <div className="infoBody">{children}</div>
      <SiteFooter />
    </main>
  )
}

/** Owner-confirmed seller facts (issue #192). Shared by legal pages and moderation-facing blocks. */
export function SellerRequisites() {
  return (
    <dl className="infoFacts">
      <div>
        <dt>Наименование</dt>
        <dd>ИП Кущев Сергей Васильевич (интернет-магазин VOZDOOH)</dd>
      </div>
      <div>
        <dt>ИНН</dt>
        <dd>270393428446</dd>
      </div>
      <div>
        <dt>ОГРНИП</dt>
        <dd>322270000003316</dd>
      </div>
      <div>
        <dt>Дата регистрации</dt>
        <dd>28.11.2022</dd>
      </div>
      <div>
        <dt>Страна регистрации</dt>
        <dd>Россия</dd>
      </div>
      <div>
        <dt>Адрес</dt>
        <dd>г. Хабаровск, ул. Павла Морозова, 97</dd>
      </div>
      <div>
        <dt>Телефон</dt>
        <dd><a className="textLink" href="tel:+79244199990">+7 924 419-99-90</a></dd>
      </div>
      <div>
        <dt>Электронная почта</dt>
        <dd><a className="textLink" href="mailto:vozdooh.kms@yandex.ru">vozdooh.kms@yandex.ru</a></dd>
      </div>
      <div>
        <dt>Сайт</dt>
        <dd><a className="textLink" href="https://vozdooh27.ru">vozdooh27.ru</a></dd>
      </div>
    </dl>
  )
}

/** A block whose concrete values the owner must still supply. */
export function OwnerBlock({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <section className="infoSection ownerBlock" aria-label={`Требует данных владельца: ${label}`}>
      <h2>{label}</h2>
      <p className="ownerNote">Эти сведения будут опубликованы после подтверждения владельцем магазина.</p>
      {children}
    </section>
  )
}

export function InfoLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link className="textLink" href={href}>{children}</Link>
}
