import { PaymentSuccessTracker } from '../../../components/PaymentSuccessTracker'

type Props = { searchParams: Promise<{ requestId?: string }> }

export default async function PaymentSuccessPage({ searchParams }: Props) {
  const requestId = (await searchParams).requestId ?? ''
  const validRequestId = /^[0-9a-f-]{36}$/i.test(requestId) ? requestId : null
  return <main className="innerPage narrow">
    <span className="eyebrow">Оплата</span>
    <h1>Статус оплаты</h1>
    {validRequestId ? <PaymentSuccessTracker requestId={validRequestId} /> : <p>Не удалось определить заказ. Проверьте ссылку возврата из Ozon Pay.</p>}
  </main>
}
