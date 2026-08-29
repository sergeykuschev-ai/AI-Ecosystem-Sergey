import Link from "next/link";
import { Container } from "@/components/ui/Container";

export function Footer() {
  return (
    <footer className="site-footer">
      <Container>
        <div className="footer-grid">
          <div>
            <strong>Ампер · Вентиль · Метиз Маркет · Миска</strong>
            <p>Четыре магазина в Амурске.</p>
          </div>
          <nav aria-label="Информация">
            <Link href="/o-kompanii/">О компании</Link>
            <Link href="/kontakty/">Контакты</Link>
            <Link href="/politika-konfidencialnosti/">Политика конфиденциальности</Link>
            <Link href="/soglasie-na-obrabotku-dannyh/">Согласие на обработку данных</Link>
          </nav>
        </div>
      </Container>
    </footer>
  );
}
