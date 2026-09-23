'use client'

import Link from 'next/link'
import { useMemo, useSyncExternalStore } from 'react'
import { clearCart, getCartSnapshot, getServerCartSnapshot, setLineQuantity, subscribeCart } from '../src/cart/storage'
import { demoProducts } from '../src/catalog/demo'

export function CartView() {
  const cart = useSyncExternalStore(subscribeCart, getCartSnapshot, getServerCartSnapshot)

  const rows = useMemo(
    () => cart.lines
      .map((line) => ({ line, product: demoProducts.find((p) => p.trade.sku === line.sku) }))
      .filter((row) => row.product !== undefined),
    [cart],
  )

  if (rows.length === 0) {
    return (
      <section className="cartEmpty">
        <span className="eyebrow">Корзина</span>
        <h1>Корзина пока пуста</h1>
        <p>Добавьте демонстрационные позиции из каталога — корзина сохранится в этом браузере.</p>
        <Link className="primary" href="/catalog">Перейти в каталог</Link>
      </section>
    )
  }

  return (
    <>
      <section className="pageIntro">
        <span className="eyebrow">Корзина</span>
        <h1>Ваш выбор</h1>
        <p>Корзина сохраняется в этом браузере и никуда не отправляется.</p>
      </section>
      <section className="cartSection">
        <div>
          <div className="cartList">
            {rows.map(({ line, product }) => (
              <div className="cartRow" key={line.sku}>
                <Link className="cartRowVisual" href={`/catalog/${product?.editorial.slug}`}>VOZDOOH</Link>
                <div>
                  <h3>{product?.trade.name}</h3>
                  <small>SKU: {line.sku} · цена после синхронизации с 1С</small>
                  <div>
                    <button type="button" className="removeButton" onClick={() => setLineQuantity(line.sku, 0)}>
                      Убрать из корзины
                    </button>
                  </div>
                </div>
                <div className="qtyControl">
                  <button type="button" aria-label="Уменьшить количество" onClick={() => setLineQuantity(line.sku, line.quantity - 1)}>−</button>
                  <b>{line.quantity}</b>
                  <button type="button" aria-label="Увеличить количество" onClick={() => setLineQuantity(line.sku, line.quantity + 1)}>+</button>
                </div>
              </div>
            ))}
          </div>
          <p className="cartClearRow"><button type="button" className="removeButton" onClick={() => clearCart()}>Очистить корзину</button></p>
        </div>
        <aside className="cartAside">
          <span className="eyebrow">Итог</span>
          <h2>Оформление пока недоступно</h2>
          <p>Корзина работает в демонстрационном режиме и хранится только в вашем браузере. Цены, наличие и стоимость доставки появятся после синхронизации с 1С — до этого заказы не создаются.</p>
          <Link className="primary" href="/checkout">Перейти к оформлению</Link>
          <p className="cartAsideBack"><Link className="textLink" href="/catalog">← Продолжить покупки</Link></p>
        </aside>
      </section>
    </>
  )
}
