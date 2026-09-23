'use client'

import Link from 'next/link'
import { useMemo, useSyncExternalStore } from 'react'
import { clearCart, getCartSnapshot, getServerCartSnapshot, setLineQuantity, subscribeCart } from '../src/cart/storage'
import type { CatalogProduct } from '../src/catalog/contracts'

export function CartView({ products, demo }: { products: CatalogProduct[]; demo: boolean }) {
  const cart = useSyncExternalStore(subscribeCart, getCartSnapshot, getServerCartSnapshot)

  const rows = useMemo(
    () => cart.lines
      .map((line) => ({ line, product: products.find((p) => p.trade.sku === line.sku) })),
    [cart, products],
  )

  if (rows.length === 0) {
    return (
      <section className="cartEmpty">
        <span className="eyebrow">Корзина</span>
        <h1>Корзина пока пуста</h1>
        <p>{demo ? 'Добавьте демонстрационные позиции из каталога — корзина сохранится в этом браузере.' : 'Добавьте позиции из каталога — корзина сохранится в этом браузере.'}</p>
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
                {product ? (
                  <Link className="cartRowVisual" href={`/catalog/${product.editorial.slug}`}>{demo ? 'DEMO' : 'INTERNAL TEST'}</Link>
                ) : <span className="cartRowVisual">Нет в каталоге</span>}
                <div>
                  <h3>{product?.trade.name ?? 'Позиция отсутствует в текущем каталоге'}</h3>
                  <small>SKU: {line.sku} · {product?.trade.price == null ? 'цена не указана' : `${product.trade.price} ₽`}</small>
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
          <p>{demo ? 'Корзина работает в демонстрационном режиме и хранится только в вашем браузере. Цены, наличие и стоимость доставки появятся после синхронизации с 1С — до этого заказы не создаются.' : 'Внутренний синтетический тест. Корзина хранится только в вашем браузере. Оформление заказа пока недоступно.'}</p>
          <Link className="primary" href="/checkout">Перейти к оформлению</Link>
          <p className="cartAsideBack"><Link className="textLink" href="/catalog">← Продолжить покупки</Link></p>
        </aside>
      </section>
    </>
  )
}
