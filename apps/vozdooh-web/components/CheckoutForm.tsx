'use client'

import Link from 'next/link'
import { useMemo, useSyncExternalStore } from 'react'
import { getCartSnapshot, getServerCartSnapshot, subscribeCart } from '../src/cart/storage'
import type { CatalogProduct } from '../src/catalog/contracts'

/**
 * Checkout UI (pre-1C state).
 * The form assembles contact and delivery data locally, but order submission
 * is deliberately disabled: no order API exists, no payment is initiated and
 * nothing is sent anywhere. This is UI scaffolding only.
 */
export function CheckoutForm({ products, demo }: { products: CatalogProduct[]; demo: boolean }) {
  const cart = useSyncExternalStore(subscribeCart, getCartSnapshot, getServerCartSnapshot)

  const rows = useMemo(
    () => cart.lines
      .map((line) => ({ line, product: products.find((p) => p.trade.sku === line.sku) })),
    [cart, products],
  )

  if (rows.length === 0) {
    return (
      <section className="cartEmpty">
        <span className="eyebrow">Оформление</span>
        <h1>Корзина пуста</h1>
        <p>Добавьте позиции из каталога, чтобы увидеть сценарий оформления заказа.</p>
        <Link className="primary" href="/catalog">Перейти в каталог</Link>
      </section>
    )
  }

  return (
    <section className="checkoutSection">
      <form className="checkoutForm" onSubmit={(event) => event.preventDefault()}>
        <fieldset>
          <legend>Контактные данные</legend>
          <div className="fieldGrid">
            <div className="field">
              <label htmlFor="checkout-name">Имя</label>
              <input id="checkout-name" name="name" autoComplete="name" required />
            </div>
            <div className="field">
              <label htmlFor="checkout-phone">Телефон</label>
              <input id="checkout-phone" name="phone" type="tel" autoComplete="tel" required />
            </div>
            <div className="field full">
              <label htmlFor="checkout-email">E-mail</label>
              <input id="checkout-email" name="email" type="email" autoComplete="email" />
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend>Способ получения</legend>
          <div className="radioRow">
            <label className="radioCard">
              <input type="radio" name="delivery" value="pickup" defaultChecked />
              <span>Самовывоз</span>
            </label>
            <label className="radioCard">
              <input type="radio" name="delivery" value="courier" />
              <span>Доставка курьером</span>
            </label>
          </div>
          <div className="fieldGrid deliveryFields">
            <div className="field full">
              <label htmlFor="checkout-address">Адрес</label>
              <input id="checkout-address" name="address" autoComplete="street-address" />
            </div>
            <div className="field full">
              <label htmlFor="checkout-comment">Комментарий</label>
              <textarea id="checkout-comment" name="comment" rows={3} />
            </div>
          </div>
        </fieldset>
      </form>

      <aside className="orderBox">
        <span className="eyebrow">Состав заказа</span>
        <h2>Ваш выбор</h2>
        {rows.map(({ line, product }) => (
          <div className="orderLine" key={line.sku}>
            <span>{product?.trade.name ?? 'Позиция отсутствует в текущем каталоге'}</span>
            <b>× {line.quantity}</b>
          </div>
        ))}
        <div className="orderTotal">
          <span>Итого</span>
          <b>По запросу</b>
        </div>
        <p className="notice">
          {demo ? 'Демонстрационный режим: цены, наличие и стоимость доставки появятся после синхронизации с 1С.' : 'Закрытый предпросмотр данных 1С. Оформление заказа пока недоступно.'}{' '}
          Кнопка оформления остаётся неактивной — заказы не создаются и данные никуда не отправляются.
        </p>
        <button type="button" className="submitDisabled" disabled>
          Оформление недоступно
        </button>
        <p className="cartAsideBack"><Link className="textLink" href="/cart">← Вернуться в корзину</Link></p>
      </aside>
    </section>
  )
}
