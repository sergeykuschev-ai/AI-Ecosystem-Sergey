/* eslint-disable @typescript-eslint/no-require-imports -- Shared synthetic QA fixture. */
// Only the intercepted payment-create request may start the synthetic payment.
function createPaymentStatusMock(scenario) {
  let started = false
  let checks = 0
  return {
    start() { started = true; checks = 0 },
    get checks() { return checks },
    status() {
      if (!started) return 'pending'
      checks++
      if (['pending', 'canceled', 'failed'].includes(scenario)) return scenario
      return checks <= (scenario === 'delayed' ? 26 : 1) ? 'pending' : 'paid'
    },
  }
}

async function countPurchases(pages) {
  const counts = await Promise.all(pages.map((page) => page.evaluate(() => (window.dataLayer || []).filter((event) => event.ecommerce?.purchase).length)))
  return counts.reduce((sum, count) => sum + count, 0)
}

module.exports = { createPaymentStatusMock, countPurchases }
