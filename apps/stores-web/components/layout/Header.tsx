import Link from "next/link";
import { TrackedLink } from "@/components/analytics/TrackedLink";
import { Container } from "@/components/ui/Container";
import { MobileNavigation } from "./MobileNavigation";

export interface PrimaryNavLink {
  label: string;
  href: string;
  event: "store_open" | "promotion_open" | "bonus_open" | "vacancy_open" | null;
}

export const primaryLinks: ReadonlyArray<PrimaryNavLink> = [
  { label: "Магазины", href: "/stores/", event: "store_open" },
  { label: "Акции", href: "/akcii/", event: "promotion_open" },
  { label: "Бонусы", href: "/bonus/", event: "bonus_open" },
  { label: "Вакансии", href: "/vakansii/", event: "vacancy_open" },
  { label: "Контакты", href: "/kontakty/", event: null },
];

export function Header() {
  return (
    <header className="site-header">
      <Container>
        <div className="header-row">
          <Link className="site-name" href="/" aria-label="На главную">
            Магазины Амурска
            <small>Ампер · Вентиль · Метиз Маркет · Миска</small>
          </Link>
          <nav className="desktop-nav" aria-label="Основная навигация">
            {primaryLinks.map(({ label, href, event }) =>
              event ? (
                <TrackedLink key={href} event={event} payload={{ source: "nav" }} href={href}>
                  {label}
                </TrackedLink>
              ) : (
                <Link key={href} href={href}>{label}</Link>
              ),
            )}
          </nav>
          <MobileNavigation links={primaryLinks} />
        </div>
      </Container>
    </header>
  );
}
