"use client";

import { useEffect } from "react";
import Link from "next/link";

interface GlobalErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalErrorPage({ error, reset }: GlobalErrorPageProps) {
  useEffect(() => {
    // Log only the opaque digest for client-side diagnostics; never render error details.
    console.error("Root layout rendering failed", { digest: error.digest });
  }, [error]);

  return (
    <html lang="ru">
      <body>
        <main style={{ maxWidth: "42rem", margin: "0 auto", padding: "4rem 1rem", fontFamily: "system-ui, sans-serif" }}>
          <h1>Страница временно недоступна</h1>
          <p>
            Не получилось загрузить данные сайта. Это временная проблема — попробуйте
            обновить страницу через минуту.
          </p>
          <p>
            <button type="button" className="button button--primary" onClick={() => reset()}>
              Попробовать снова
            </button>{" "}
            <Link href="/">На главную</Link>
          </p>
        </main>
      </body>
    </html>
  );
}
