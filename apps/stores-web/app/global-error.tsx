"use client";

import { useEffect } from "react";
import Link from "next/link";

interface GlobalErrorPageProps {
  error: Error & { digest?: string };
  retry: () => void;
}

export default function GlobalErrorPage({ error, retry }: GlobalErrorPageProps) {
  useEffect(() => {
    // Server-side details (including the digest) stay in logs; never render them.
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
            <button type="button" className="button button--primary" onClick={() => retry()}>
              Попробовать снова
            </button>{" "}
            <Link href="/">На главную</Link>
          </p>
        </main>
      </body>
    </html>
  );
}
