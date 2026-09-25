'use client'

import Link from 'next/link'

export default function ErrorPage({ retry }: { retry: () => void }) {
  return <main className="cartEmpty" role="alert">
    <h1>Не удалось загрузить страницу</h1>
    <p>Попробуйте ещё раз. Если ошибка повторится, вернитесь позже.</p>
    <button className="primary" onClick={retry}>Повторить загрузку</button>
    <p><Link className="textLink" href="/cart">Перейти в корзину</Link></p>
  </main>
}
