import Link from "next/link";
import { Container } from "@/components/ui/Container";
import { MobileNavigation } from "./MobileNavigation";

const primaryLinks = [
  ["Магазины", "/stores/"],
  ["Акции", "/akcii/"],
  ["Бонусы", "/bonus/"],
  ["Вакансии", "/vakansii/"],
  ["Контакты", "/kontakty/"],
] as const;

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
            {primaryLinks.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}
          </nav>
          <MobileNavigation links={primaryLinks} />
        </div>
      </Container>
    </header>
  );
}
