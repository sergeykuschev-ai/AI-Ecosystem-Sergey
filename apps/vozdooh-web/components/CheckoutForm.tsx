'use client'

import Link from 'next/link'
import { submitRequest } from '../src/commerce/submitRequest'
import { useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { getCartSnapshot, getServerCartSnapshot, subscribeCart } from '../src/cart/storage'
import type { CatalogProduct } from '../src/catalog/contracts'

const errors: Record<string, string> = {
  STOCK_CHANGED: 'Наличие изменилось. Вернитесь в корзину и обновите страницу.',
  PRICE_CHANGED: 'Цена изменилась. Обновите страницу и проверьте сумму перед повторной отправкой.',
  PRICE_UNAVAILABLE: 'Для одной из позиций нет доступной цены. Проверьте корзину.',
  INVALID_PHONE: 'Укажите телефон: от 10 до 15 цифр.',
  INVALID_CONTACT_OR_DELIVERY: 'Проверьте имя, адрес и комментарий.',
  INVALID_DELIVERY: 'Выберите способ получения.',
  INVALID_QUANTITY: 'Количество должно быть целым числом от 1 до 999.',
  INVALID_CART: 'Проверьте состав корзины.',
  CONSENT_REQUIRED: 'Для отправки заявки необходимо согласие.',
  RETRY_CONFLICT: 'Эта попытка уже содержит другую заявку. Обновите страницу.',
}
const money = (minor: number) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(minor / 100)

export function CheckoutForm({ products, enabled }: { products: CatalogProduct[]; enabled: boolean }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [method, setMethod] = useState('pickup')
  const [success, setSuccess] = useState<{ id: string; totalMinor: number } | null>(null)
  const attempt = useRef<{ signature: string; retryKey: string } | null>(null)
  const busy = useRef(false)
  const cart = useSyncExternalStore(subscribeCart, getCartSnapshot, getServerCartSnapshot)

  const rows = useMemo(
    () => cart.lines
      .map((line) => ({ line, product: products.find((p) => p.trade.sku === line.sku) })),
    [cart, products],
  )

  const valid = rows.length > 0 && rows.every(({ line, product }) => product && Number.isSafeInteger(line.quantity) && line.quantity > 0 && line.quantity <= 999 && (product.trade.stock ?? 0) >= line.quantity && (product.trade.price ?? 0) > 0)
  const total = rows.reduce((sum, { line, product }) => sum + Math.round((product?.trade.price ?? 0) * 100) * line.quantity, 0)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy.current || !enabled || !valid) return
    busy.current = true
    setPending(true)
    setError('')
    const fields = new FormData(event.currentTarget)
    const payload = {
      lines: rows.map(({ line, product }) => ({ ...line, expectedPriceMinor: Math.round((product?.trade.price ?? 0) * 100) })),
      contact: { name: fields.get('name'), phone: fields.get('phone') },
      delivery: { method: fields.get('delivery'), address: fields.get('address') ?? '', comment: fields.get('comment') },
      consent: fields.get('consent') === 'on',
    }
    try {
      const signature = JSON.stringify(payload)
      // Persist only the random retry key and a one-way digest, never contact data.
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signature))), (b) => b.toString(16).padStart(2, '0')).join('')
      if (!attempt.current) {
        try { attempt.current = JSON.parse(sessionStorage.getItem('vozdooh-request-attempt') ?? 'null') } catch { /* Storage can be unavailable. */ }
      }
      if (attempt.current?.signature !== digest) attempt.current = { signature: digest, retryKey: crypto.randomUUID() }
      try { sessionStorage.setItem('vozdooh-request-attempt', JSON.stringify(attempt.current)) } catch { /* In-memory retry key still protects this tab. */ }
      const result = await submitRequest({ ...payload, retryKey: attempt.current.retryKey })
      setSuccess(result)
    } catch (failure) {
      const code = failure && typeof failure === 'object' && 'code' in failure ? String(failure.code) : ''
      setError(errors[code] ?? 'Не удалось получить подтверждение. Повторите отправку с теми же данными: повторная заявка не создастся.')
    } finally { busy.current = false; setPending(false) }
  }

  if (success) return <section className="cartEmpty" role="status">
    <h2>Заявка получена</h2>
    <p>Номер заявки: {success.id}</p>
    <p>Стоимость товаров: {money(success.totalMinor)}.</p>
    <p>Заявка сохранена для ручной обработки. Это не подтверждение заказа или резерва. Оплата не проводилась. Наличие, способ получения и стоимость доставки требуют согласования.</p>
    <Link className="primary" href="/catalog">Вернуться в каталог</Link>
  </section>

  if (rows.length === 0) {
    return (
      <section className="cartEmpty">
        <span className="eyebrow">Оформление</span>
        <h2>Корзина пуста</h2>
        <p>Добавьте позиции из каталога, чтобы увидеть сценарий оформления заказа.</p>
        <Link className="primary" href="/catalog">Перейти в каталог</Link>
      </section>
    )
  }

  return (
    <section className="checkoutSection">
      <form id="request-form" className="checkoutForm" onSubmit={submit} aria-busy={pending}>
        <fieldset disabled={pending}>
          <legend>Контактные данные</legend>
          <div className="fieldGrid">
            <div className="field">
              <label htmlFor="checkout-name">Имя</label>
              <input id="checkout-name" name="name" autoComplete="name" maxLength={100} required />
            </div>
            <div className="field">
              <label htmlFor="checkout-phone">Телефон</label>
              <input id="checkout-phone" name="phone" type="tel" autoComplete="tel" maxLength={32} required />
            </div>
          </div>
        </fieldset>

        <fieldset disabled={pending}>
          <legend>Способ получения</legend>
          <div className="radioRow">
            <label className="radioCard">
              <input type="radio" name="delivery" value="pickup" checked={method === 'pickup'} onChange={() => setMethod('pickup')} />
              <span>Самовывоз</span>
            </label>
            <label className="radioCard">
              <input type="radio" name="delivery" value="courier" checked={method === 'courier'} onChange={() => setMethod('courier')} />
              <span>Доставка курьером</span>
            </label>
          </div>
          <div className="fieldGrid deliveryFields">
            <div className="field full">
              <label htmlFor="checkout-address">Адрес</label>
              <input id="checkout-address" name="address" autoComplete="street-address" maxLength={500} required={method === 'courier'} disabled={method === 'pickup'} />
            </div>
            <div className="field full">
              <label htmlFor="checkout-comment">Комментарий</label>
              <textarea id="checkout-comment" name="comment" rows={3} maxLength={1000} />
            </div>
          </div>
        </fieldset>
        <label><input type="checkbox" name="consent" required disabled={pending} /> Согласен на сохранение имени, телефона и указанных данных получения для обработки этой заявки и связи со мной. Данные хранятся на сервере VOZDOOH.</label>
        {error && <p role="alert">{error}</p>}
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
          <b>{valid ? money(total) : 'Проверьте корзину'}</b>
        </div>
        <p className="notice">{enabled ? 'Отправляется заявка для ручной обработки. Оплата не подключена. Товары не резервируются. Доступность курьера и стоимость доставки согласуются отдельно и не входят в сумму.' : 'Приём заявок доступен только для действующего каталога 1С.'}</p>
        {!valid && <p role="alert">Проверьте количество, наличие и цены в корзине.</p>}
        <button type="submit" form="request-form" className="primary" disabled={!enabled || !valid || pending}>
          {pending ? 'Сохраняем…' : 'Отправить заявку'}
        </button>
        <p className="cartAsideBack"><Link className="textLink" href="/cart">← Вернуться в корзину</Link></p>
      </aside>
    </section>
  )
}
