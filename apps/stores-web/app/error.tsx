"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Container } from "@/components/ui/Container";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    // Log only the opaque digest for client-side diagnostics; never render error details.
    console.error("Page rendering failed", { digest: error.digest });
  }, [error]);

  return (
    <main>
      <Container>
        <header className="page-hero">
          <p className="eyebrow">Ошибка</p>
          <h1>Страница временно недоступна</h1>
          <p className="lead">
            Не получилось загрузить данные сайта. Это временная проблема — попробуйте
            обновить страницу через минуту.
          </p>
          <div className="button-row">
            <button type="button" className="button button--primary" onClick={() => reset()}>
              Попробовать снова
            </button>
            <Link className="button button--secondary" href="/">
              На главную
            </Link>
          </div>
        </header>
      </Container>
    </main>
  );
}
