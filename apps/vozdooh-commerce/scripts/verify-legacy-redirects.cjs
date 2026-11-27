/* eslint-disable @typescript-eslint/no-require-imports -- Opt-in isolated HTTP regression. */
const assert = require('node:assert/strict')
const base = process.env.VOZDOOH_QA_URL || 'http://127.0.0.1:34933'
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'Run against a loopback isolated build only')

;(async () => {
  let checks = 0
  const paths = {
    '/kontakty.html': '/contacts', '/kontakty.html/': '/contacts',
    '/aromaty-dlya-doma/aromaticheskie-svechi': '/categories/candles',
    '/aromaty-dlya-doma/aromaticheskie-svechi/': '/categories/candles',
  }
  for (const [path, target] of Object.entries(paths)) for (const method of ['GET', 'HEAD']) {
    for (const query of ['', '?utm_source=qa', '?token=synthetic-private&next=https%3A%2F%2Fevil.test%2F&redirect=%2F%2Fevil.test']) {
      const response = await fetch(base + path + query, { method, redirect: 'manual' })
      assert.equal(response.status, 301, method + ' ' + path)
      const destination = new URL(response.headers.get('location'), base)
      assert.equal(destination.href, base + target)
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
      if (method === 'HEAD') assert.equal(await response.text(), '')
      const final = await fetch(destination, { method, redirect: 'manual' })
      assert.equal(final.status, 200)
      assert.equal(final.headers.get('location'), null)
      if (method === 'GET') {
        const html = await final.text()
        assert.ok(html.includes(`href="https://vozdooh27.ru${target}"`))
        assert.match(html, /content="index, follow"/)
      }
      checks++
    }
  }
  for (const path of ['/kontaktyXhtml', '/kontakty.html/child', '/aromaty-dlya-doma/aromaticheskie-svechi/child', '/aromaty-dlya-doma/aromaticheskie-svechi-other', '/blog-s/blog1.html']) {
    for (const method of ['GET', 'HEAD']) {
      const response = await fetch(base + path + '?next=https://evil.test', { method, redirect: 'manual' })
      assert.equal(response.status, 404, path)
      assert.equal(response.headers.get('location'), null)
      checks++
    }
  }
  for (const path of ['/contacts', '/categories/candles', '/catalog', '/checkout', '/cart', '/api/payments/ozon/notification', '/unmapped-legacy']) {
    const response = await fetch(base + path + '/?qa=preserved', { redirect: 'manual' })
    assert.equal(response.status, 308, path)
    assert.equal(new URL(response.headers.get('location'), base).href, base + path + '?qa=preserved')
    checks++
  }
  for (const [path, status] of [['/catalog?page=1&q=qa', 308], ['/catalog?page=2', 404], ['/catalog?q=qa', 200]]) {
    const response = await fetch(base + path, { redirect: 'manual' })
    assert.equal(response.status, status)
    if (status === 308) assert.equal(new URL(response.headers.get('location'), base).href, base + '/catalog?q=qa')
    checks++
  }
  console.log(`PASS: ${checks} isolated HTTP redirect, query, target and normalization checks`)
})().catch(error => { console.error(error); process.exitCode = 1 })
