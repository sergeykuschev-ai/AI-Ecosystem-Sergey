import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page not-found">
      <h1>Страница не найдена</h1>
      <p>
        <Link href="/">Вернуться на главную</Link>
      </p>
    </main>
  );
}
