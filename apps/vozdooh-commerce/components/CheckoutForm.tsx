'use client'

import Link from 'next/link'
import { parseRequest, PICKUP_ADDRESS } from '../src/commerce/requestValidation'
import { submitRequest } from '../src/commerce/submitRequest'
import { fetchOrderDeliveryQuote, type DeliveryQuotePresentation } from '../src/commerce/deliveryQuoteClient'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { bindPaymentCart, capturePaymentCart, getCartSnapshot, getServerCartSnapshot, selectPaymentCartAttempt, subscribeCart } from '../src/cart/storage'
import type { CatalogProduct } from '../src/catalog/contracts'
import { productPayload, trackEvent } from '../src/integrations/analytics'

const errors: Record<string, string> = {
  STOCK_CHANGED: 'Наличие изменилось. Вернитесь в корзину и обновите страницу.',
  PRICE_CHANGED: 'Цена изменилась. Обновите страницу и проверьте сумму перед повторной отправкой.',
  PRICE_UNAVAILABLE: 'Для одной из позиций нет доступной цены. Проверьте корзину.',
  INVENTORY_STALE: 'Остатки 1С сейчас не подтверждены. Оформление временно приостановлено — повторите после обновления остатков.',
  INVALID_PHONE: 'Укажите телефон: от 10 до 15 цифр.',
  INVALID_EMAIL: 'Укажите корректный email для уведомлений о заказе.',
  INVALID_CONTACT_OR_DELIVERY: 'Проверьте имя, адрес и комментарий.',
  INVALID_DELIVERY: 'Выберите способ получения.',
  INVALID_QUANTITY: 'Количество должно быть целым числом от 1 до 999.',
  INVALID_CART: 'Проверьте состав корзины.',
  CONSENT_REQUIRED: 'Для оформления заказа необходимо согласие.',
  RETRY_CONFLICT: 'Эта попытка уже содержит другой заказ. Обновите страницу.',
}
const money = (minor: number) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' }).format(minor / 100)

export function CheckoutForm({ products, enabled }: { products: CatalogProduct[]; enabled: boolean }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [method, setMethod] = useState('ozon-pvz')
  const [pvzQuery, setPvzQuery] = useState('')
  const [pvzPoints, setPvzPoints] = useState<Array<{ delivery_point_id: number; name: string; full_address: string; shipment_method_ids: number[] }>>([])
  const [pvzLoading, setPvzLoading] = useState(false)
  const [pvzSearched, setPvzSearched] = useState(false)
  const pvzSearchVersion = useRef(0)
  const [selectedPvz, setSelectedPvz] = useState<number | null>(null)
  const [success, setSuccess] = useState<{ id: string; totalMinor: number; deliveryMethod: 'courier' | 'ozon-pvz' | 'pickup' } | null>(null)
  const [paymentPending, setPaymentPending] = useState(false)
  const [quotePending, setQuotePending] = useState(false)
  const [quoteError, setQuoteError] = useState('')
  const [deliveryQuote, setDeliveryQuote] = useState<DeliveryQuotePresentation | null>(null)
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
  const checkoutTracked = useRef(false)

  useEffect(() => {
    if (checkoutTracked.current || !valid) return
    checkoutTracked.current = true
    trackEvent('begin_checkout', {
      value: total / 100,
      currency: 'RUB',
      items: rows.flatMap(({ product }) => (product ? [productPayload(product)] : [])),
    })
  }, [valid, total, rows])

  function changePvzQuery(query: string) {
    // Once the destination changes, any old point selection becomes invalid.
    pvzSearchVersion.current += 1
    setPvzQuery(query)
    setPvzPoints([])
    setSelectedPvz(null)
    setPvzSearched(false)
    setPvzLoading(false)
  }

  async function searchPvz() {
    const query = pvzQuery.trim()
    if (query.length < 2) return
    const version = ++pvzSearchVersion.current
    setPvzLoading(true)
    setSelectedPvz(null)
    setPvzPoints([])
    setPvzSearched(true)
    setError('')
    try {
      const response = await fetch('/api/ozon/pickup-points', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) })
      const data = await response.json() as { delivery_points?: Array<{ delivery_point_id: number; name: string; full_address: string; shipment_method_ids: number[] }> }
      if (!response.ok || !Array.isArray(data.delivery_points)) throw new Error('PVZ')
      if (version !== pvzSearchVersion.current) return
      // A point without an Ozon shipment method cannot be used in the delivery API.
      setPvzPoints(data.delivery_points.filter((point) => point.shipment_method_ids?.length > 0))
    } catch {
      if (version === pvzSearchVersion.current) setError('Не удалось загрузить пункты Ozon. Повторите поиск.')
    } finally {
      if (version === pvzSearchVersion.current) setPvzLoading(false)
    }
  }


  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy.current || !enabled || !valid) return
    busy.current = true
    setPending(true)
    setError('')
    const fields = new FormData(event.currentTarget)
    const payload = {
      lines: rows.map(({ line, product }) => ({ ...line, expectedPriceMinor: Math.round((product?.trade.price ?? 0) * 100) })),
      contact: { name: fields.get('name'), phone: fields.get('phone'), email: fields.get('email') },
      delivery: { method: fields.get('delivery'), address: fields.get('delivery') === 'ozon-pvz' ? String(fields.get('pvzAddress') ?? '') : fields.get('address') ?? '', comment: fields.get('comment'), ...(fields.get('delivery') === 'ozon-pvz' ? { deliveryPointId: Number(fields.get('pvzId')), shipmentMethodId: Number(fields.get('shipmentMethodId')) } : {}) },
      consent: fields.get('consent') === 'on',
      marketingConsent: fields.get('marketingConsent') === 'on',
    }
    try {
      // Validate and normalize exactly as the server does before sending contact data.
      const { retryKey: candidateKey, ...normalized } = parseRequest({ ...payload, retryKey: crypto.randomUUID() }, { requireEmail: true })
      try { capturePaymentCart(candidateKey, normalized.lines) } catch { /* No snapshot: preserve cart on payment return. */ }
      // Keep the existing digest format so attempts saved before this change remain retryable.
      const signature = JSON.stringify(payload)
      // Persist only the random retry key and a one-way digest, never contact data.
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signature))), (b) => b.toString(16).padStart(2, '0')).join('')
      if (!attempt.current) {
        try { attempt.current = JSON.parse(sessionStorage.getItem('vozdooh-request-attempt') ?? 'null') } catch { /* Storage can be unavailable. */ }
      }
      if (attempt.current?.signature !== digest) attempt.current = { signature: digest, retryKey: candidateKey }
      try { selectPaymentCartAttempt(candidateKey, attempt.current.retryKey) } catch { /* A retry retains only its original snapshot. */ }
      try { sessionStorage.setItem('vozdooh-request-attempt', JSON.stringify(attempt.current)) } catch { /* In-memory retry key still protects this tab. */ }
      const result = await submitRequest({ ...normalized, retryKey: attempt.current.retryKey })
      try { bindPaymentCart(attempt.current.retryKey, result.id) } catch { /* Cleanup requires a persisted order binding. */ }
      trackEvent('submit_order', { request_id: result.id, value: result.totalMinor / 100, currency: result.currency })
      setSuccess({ ...result, deliveryMethod: normalized.delivery.method })
      // Ozon PVZ estimates are read-only. Courier pricing is agreed separately.
      if (normalized.delivery.method === 'ozon-pvz') void estimateDelivery(result.id, result.totalMinor)
    } catch (failure) {
      const code = failure && typeof failure === 'object' && 'code' in failure ? String(failure.code) : ''
      setError(errors[code] ?? 'Не удалось получить подтверждение. Повторите отправку с теми же данными: повторный заказ не создастся.')
    } finally { busy.current = false; setPending(false) }
  }

  async function estimateDelivery(requestId: string, productTotalMinor: number) {
    setQuotePending(true)
    setQuoteError('')
    setDeliveryQuote(null)
    try {
      const quote = await fetchOrderDeliveryQuote(requestId, productTotalMinor)
      setDeliveryQuote(quote)
    } catch {
      setQuoteError('Не удалось получить надёжный тариф Ozon для этого заказа. Стоимость доставки согласуем отдельно до отправки.')
    } finally { setQuotePending(false) }
  }

  async function pay() {
    if (!success || paymentPending) return
    setPaymentPending(true); setError('')
    try {
      const response = await fetch('/api/payments/ozon/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: success.id }) })
      const result = await response.json() as { redirectUrl?: unknown; code?: unknown }
      if (!response.ok) {
        const code = typeof result.code === 'string' ? result.code : ''
        if (code === 'INVENTORY_STALE') {
          setError(errors.INVENTORY_STALE)
          setPaymentPending(false)
          return
        }
        throw new Error('PAYMENT_UNAVAILABLE')
      }
      if (typeof result.redirectUrl !== 'string' || !result.redirectUrl.startsWith('https://')) throw new Error('PAYMENT_UNAVAILABLE')
      window.location.assign(result.redirectUrl)
    } catch {
      setError('Не удалось открыть оплату Ozon Pay. Заказ сохранён — попробуйте оплатить ещё раз.')
      setPaymentPending(false)
    }
  }

  if (success) return <section className="cartEmpty" role="status">
    <h2>Заказ оформлен — ожидает оплаты</h2>
    <p>Номер заказа: {success.id}</p>
    <p>Стоимость товаров: {money(success.totalMinor)}.</p>
    {quotePending && <p role="status">Рассчитываем предварительную стоимость доставки Ozon…</p>}
    {success.deliveryMethod === 'ozon-pvz' && !quotePending && (deliveryQuote || quoteError) && <button type="button" onClick={() => void estimateDelivery(success.id, success.totalMinor)}>Обновить расчёт доставки</button>}
    {deliveryQuote && <div role="status">
      <p>Предварительная стоимость доставки Ozon: {money(Math.round(deliveryQuote.estimatedTotalDeliveryRub * 100))}.</p>
      {deliveryQuote.provisionalLogistics && <p><b>Расчёт по примерным данным:</b> вес и размеры товара взяты из открытых источников, а коробка и защитные материалы учтены ориентировочно. Окончательная стоимость будет согласована после проверки упаковки.</p>}
      <p>Ориентировочная общая стоимость товаров и доставки: <b>{money(deliveryQuote.estimatedCombinedTotalMinor)}</b>.</p>
      {deliveryQuote.estimatedDeliveryDays !== null && <p>Оценка срока доставки Ozon: {deliveryQuote.estimatedDeliveryDays} дн.</p>}
      <p><b>Важно:</b> через Ozon Pay сейчас оплачиваются только товары. Доставка не входит в сумму платежа и согласовывается отдельно до отправки.</p>
    </div>}
    {quoteError && <p role="status">{quoteError}</p>}
    {success.deliveryMethod === 'pickup' ? <p>Самовывоз — бесплатно (0 руб.). {PICKUP_ADDRESS}. Выдача только после подтверждения готовности заказа; время согласуем отдельно.</p> : <p>Стоимость доставки не входит в оплату товаров через Ozon Pay. Перед отправкой мы отдельно подтвердим тариф и способ оплаты доставки.</p>}
    <p>Заказ сохранён. Сумма к оплате: {money(success.totalMinor)}. После перехода в Ozon Pay завершите оплату там.</p>
    {error && <p role="alert">{error}</p>}
    <button className="primary" type="button" onClick={pay} disabled={paymentPending}>{paymentPending ? 'Открываем Ozon Pay…' : 'Оплатить через Ozon Pay'}</button>
    <p><Link className="textLink" href="/catalog">Вернуться в каталог</Link></p>
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
              <input id="checkout-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={32} aria-describedby="checkout-phone-help" required />
              <small id="checkout-phone-help">От 10 до 15 цифр; допустимы +, пробелы, скобки и дефисы.</small>
            </div>
            <div className="field">
              <label htmlFor="checkout-email">Email</label>
              <input id="checkout-email" name="email" type="email" inputMode="email" autoComplete="email" maxLength={254} aria-describedby="checkout-email-help" required />
              <small id="checkout-email-help">На этот адрес придут подтверждение заказа и изменения статуса.</small>
            </div>
          </div>
        </fieldset>

        <fieldset disabled={pending}>
          <legend>Способ получения</legend>
          <div className="radioRow">
            <label className="radioCard">
              <input type="radio" name="delivery" value="ozon-pvz" checked={method === 'ozon-pvz'} onChange={() => setMethod('ozon-pvz')} />
              <span>Пункт Ozon</span>
            </label>
            <label className="radioCard">
              <input type="radio" name="delivery" value="courier" checked={method === 'courier'} onChange={() => setMethod('courier')} />
              <span>Доставка курьером</span>
            </label>
            <label className="radioCard">
              <input type="radio" name="delivery" value="pickup" checked={method === 'pickup'} onChange={() => setMethod('pickup')} />
              <span>Самовывоз — бесплатно</span>
            </label>
          </div>
          {method === 'pickup' && <div className="fieldGrid deliveryFields"><div className="field full"><strong>{PICKUP_ADDRESS}</strong><p>Самовывоз бесплатный (0 руб.). Выдача только после подтверждения готовности заказа. Время согласуем отдельно.</p><input type="hidden" name="address" value={PICKUP_ADDRESS} /></div></div>}
          {method === 'ozon-pvz' && <div className="fieldGrid deliveryFields">
            <div className="field full">
              <label htmlFor="pvz-search">Город или адрес пункта Ozon</label>
              <div className="radioRow"><input id="pvz-search" value={pvzQuery} placeholder="Например, Хабаровск или Владивосток" onChange={(e) => changePvzQuery(e.target.value)} /><button type="button" onClick={searchPvz} disabled={pvzLoading}>{pvzLoading ? 'Ищем…' : 'Найти ПВЗ'}</button></div>
              {pvzSearched && pvzPoints.length === 0 && !pvzLoading && !error && <small>Пунктов по запросу пока не найдено. Уточните город или адрес.</small>}
              {pvzPoints.map((point) => <label className="radioCard" key={point.delivery_point_id}>
                <input type="radio" name="pvzId" value={point.delivery_point_id} checked={selectedPvz === point.delivery_point_id} onChange={() => setSelectedPvz(point.delivery_point_id)} required={method === 'ozon-pvz'} />
                <span><b>{point.name}</b><br />{point.full_address}</span>
                {selectedPvz === point.delivery_point_id && <><input type="hidden" name="pvzAddress" value={point.full_address} /><input type="hidden" name="shipmentMethodId" value={point.shipment_method_ids[0] ?? ''} /></>}
              </label>)}
            </div>
          </div>}
          <div className="fieldGrid deliveryFields">
            <div className="field full" hidden={method !== 'courier'}>
              <label htmlFor="checkout-address">Адрес</label>
              <input id="checkout-address" name="address" autoComplete="street-address" maxLength={500} required={method === 'courier'} disabled={method !== 'courier'} />
            </div>
            <div className="field full">
              <label htmlFor="checkout-comment">Комментарий (необязательно)</label>
              <textarea id="checkout-comment" name="comment" rows={3} maxLength={1000} />
            </div>
          </div>
        </fieldset>
        <label className="consentField"><input type="checkbox" name="consent" required disabled={pending} /> Согласен на сохранение имени, телефона, email и указанных данных получения для обработки заказа, связи со мной и отправки сервисных уведомлений о его статусе. Данные хранятся на сервере VOZDOOH.</label>
        <label className="consentField"><input type="checkbox" name="marketingConsent" disabled={pending} /> Согласен получать на email новости VOZDOOH, новые поступления и специальные предложения. От рассылки можно отказаться в любой момент.</label>
        <p><Link className="textLink" href="/privacy">Политика конфиденциальности</Link> · <Link className="textLink" href="/delivery">Условия доставки</Link> · <Link className="textLink" href="/payment">Порядок оплаты</Link></p>
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
        <p className="notice">{enabled && method === 'pickup' ? 'Самовывоз — бесплатно (0 руб.). После оформления заказа можно оплатить товары через Ozon Pay. Выдача только после подтверждения готовности; время согласуем отдельно. Товары не резервируются до подтверждения оплаты.' : enabled ? 'Сначала сохраняется заказ, затем можно оплатить товары через Ozon Pay. Для пункта Ozon рассчитывается предварительная стоимость доставки. Доставка оплачивается отдельно после согласования тарифа и не входит в указанную сумму. Товары не резервируются до подтверждения оплаты.' : 'Оформление заказов доступно только для действующего каталога 1С.'}</p>
        {!valid && <p role="alert">Проверьте количество, наличие и цены в корзине.</p>}
        <button type="submit" form="request-form" className="primary" disabled={!enabled || !valid || pending}>
          {pending ? 'Сохраняем…' : 'Оформить заказ'}
        </button>
        <p className="cartAsideBack"><Link className="textLink" href="/cart">← Вернуться в корзину</Link></p>
      </aside>
    </section>
  )
}
