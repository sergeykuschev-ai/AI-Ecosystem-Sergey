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
          <nav aria-label="Магазины">
            <Link href="/amper/">Электротовары «Ампер»</Link>
            <Link href="/ventil/">Сантехника «Вентиль»</Link>
            <Link href="/metiz-market/">Крепёж «Метиз Маркет»</Link>
            <Link href="/miska/">Зоотовары «Миска»</Link>
            <Link href="/stores/">Все магазины в Амурске</Link>
          </nav>
          <nav aria-label="Покупателям">
            <Link href="/akcii/">Акции</Link>
            <Link href="/bonus/">Бонусная программа</Link>
            <Link href="/kontakty/">Контакты</Link>
            <Link href="/faq/">Частые вопросы</Link>
          </nav>
          <nav aria-label="Информация">
            <Link href="/o-kompanii/">О компании</Link>
            <Link href="/vakansii/">Вакансии</Link>
            <Link href="/politika-konfidencialnosti/">Политика конфиденциальности</Link>
            <Link href="/soglasie-na-obrabotku-dannyh/">Согласие на обработку данных</Link>
          </nav>
        </div>
      </Container>
    </footer>
  );
}
