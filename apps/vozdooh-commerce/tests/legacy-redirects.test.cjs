/* eslint-disable @typescript-eslint/no-require-imports -- Exact legacy URL policy regression. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { NextRequest } = require('next/server')
const { proxy } = require('../proxy.ts')

test('only proven legacy paths permanently redirect GET/HEAD, discarding the whole query', () => {
  const paths = {
    '/kontakty.html': '/contacts',
    '/kontakty.html/': '/contacts',
    '/aromaty-dlya-doma/aromaticheskie-svechi': '/categories/candles',
    '/aromaty-dlya-doma/aromaticheskie-svechi/': '/categories/candles',
  }
  for (const [path, destination] of Object.entries(paths)) for (const method of ['GET', 'HEAD']) {
    const response = proxy(new NextRequest(`https://example.test${path}?token=private&next=https%3A%2F%2Fevil.test&brand=ignored`, { method }))
    assert.equal(response.status, 301)
    assert.equal(response.headers.get('location'), `https://example.test${destination}`)
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
  }
})

test('no broad legacy mask, destination loop, commerce interception or unsafe method redirect', () => {
  for (const path of ['/kontaktyXhtml', '/kontakty.html/child', '/Kontakty.html', '/contacts', '/categories/candles',
    '/aromaty-dlya-doma/aromaticheskie-svechi-other', '/aromaty-dlya-doma/aromaticheskie-svechi/child',
    '/checkout', '/api/payments/ozon/notification', '/cart']) {
    const response = proxy(new NextRequest(`https://example.test${path}?page=2&next=//evil.test`))
    assert.equal(response.status, 200, path)
    assert.equal(response.headers.get('location'), null, path)
  }
  assert.equal(proxy(new NextRequest('https://example.test/kontakty.html', { method: 'POST' })).headers.get('location'), null)
})
