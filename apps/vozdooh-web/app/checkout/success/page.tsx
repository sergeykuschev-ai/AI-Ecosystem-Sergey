import { PaymentSuccessTracker } from '../../../components/PaymentSuccessTracker'

type Props = { searchParams: Promise<{ requestId?: string }> }

export default async function PaymentSuccessPage({ searchParams }: Props) {
  const requestId = (await searchParams).requestId ?? ''
  const validRequestId = /^[0-9a-f-]{36}$/i.test(requestId) ? requestId : null
  return <main className="innerPage narrow">
    {validRequestId && <PaymentSuccessTracker requestId={validRequestId} />}
    <span className="eyebrow">Оплата</span>
    <h1>Платёж принят</h1>
    <p>Спасибо. Мы проверяем подтверждение оплаты и обновим статус заказа автоматически.</p>
  </main>
}
