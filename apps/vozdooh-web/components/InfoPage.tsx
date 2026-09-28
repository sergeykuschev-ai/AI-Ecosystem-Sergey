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
