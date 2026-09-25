import Link from 'next/link'

export default function NotFound() {
  return <main className="cartEmpty">
    <h1>Страница не найдена</h1>
    <p>Возможно, ссылка устарела. Выберите товары в каталоге.</p>
    <Link className="primary" href="/catalog">Перейти в каталог</Link>
  </main>
}
