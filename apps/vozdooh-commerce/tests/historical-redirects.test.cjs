/* eslint-disable @typescript-eslint/no-require-imports -- Dependency-free candidate checks. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { stripTypeScriptTypes } = require('node:module')

// Execute the actual TypeScript policy and proxy with a minimal response double.
// This verifies branching and headers, not Next.js matcher/normalization runtime parity.
function loadSource(file, bindings, exports) {
  const source = stripTypeScriptTypes(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'))
    .replace(/^import .*$/gm, '').replace(/^export /gm, '')
  return vm.runInNewContext(`${source}\n;({ ${exports} })`, bindings)
}
const { historicalRedirect } = loadSource('src/seo/historicalRedirects.ts', {}, 'historicalRedirect')
const { catalogPaginationPolicy } = loadSource('src/seo/catalogPolicy.ts', {}, 'catalogPaginationPolicy')
class ResponseDouble extends Response {
  static next() { return new ResponseDouble(null, { headers: { 'x-test-next': 'true' } }) }
  static redirect(url, status) { return new ResponseDouble(null, { status, headers: { Location: String(url) } }) }
}
const { proxy, config } = loadSource('proxy.ts', {
  NextResponse: ResponseDouble,
  historicalRedirect,
  catalogPaginationPolicy,
}, 'proxy, config')
const mappings = [
  ['/kontakty.html', '/contacts'],
  ['/dostavka.html', '/delivery'],
  ['/aromaty-dlya-doma/aromaticheskie-svechi', '/categories/candles'],
  ['/aromaty-dlya-doma/aromaticheskie-svechi/', '/categories/candles'],
  ['/decor-classic-diffuzor-aramara-250ml.html', '/catalog/culti-decor-aramara-250'],
  ['/vellutier-svecha-bolshaya-vecherniy-tost-515gr-midnight-toast.html', '/catalog/vellutier-midnight-toast-515'],
]
function request(pathname, method = 'GET') {
  const nextUrl = new URL(pathname, 'https://example.test')
  nextUrl.clone = () => new URL(nextUrl)
  return { nextUrl, method }
}

test('exact allowlist GET/HEAD returns one fixed 301 with no query, body or loop', () => {
  assert.equal(config.matcher.length, mappings.length + 1)
  for (const [source, destination] of mappings) {
    assert.ok(config.matcher.includes(source))
    for (const method of ['GET', 'HEAD']) {
      for (const query of ['', '?token=synthetic&next=https://other.test/&page=2', '?url=//other.test&x=%0d%0a']) {
        const response = proxy(request(source + query, method))
        assert.equal(response.status, 301)
        assert.equal(response.headers.get('location'), destination)
        assert.equal(response.body, null)
        assert.equal(historicalRedirect(destination, method), undefined)
      }
    }
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      assert.equal(proxy(request(source, method)).headers.get('location'), null)
    }
  }
})

test('unverified sizes, unknown paths, encoded and malformed paths do not match', () => {
  for (const pathname of [
    '/unknown.html', '/kontakty.html/extra', '/kontakty.html/', '/KONTAKTY.html',
    '/vellutier-svecha-sibirskij-les-225gr-siberian-pine-forest.html',
    '/vellutier-svecha-bolshaya-vecherniy-tost-225gr-midnight-toast.html',
    '/decor-classic-diffuzor-aramara-500ml.html',
    '/%6bontakty.html', '/kontakty%2ehtml', '/kontakty.html%2f',
    '//kontakty.html', '/%2fkontakty.html', '/kontakty.html%00', '/kontakty.html%',
    '/aromaty-dlya-doma%2faromaticheskie-svechi/',
  ]) assert.equal(historicalRedirect(pathname, 'GET'), undefined, pathname)
  for (const pathname of ['/unknown.html?page=2', '/contacts?page=2', '/catalog/unknown?page=2']) {
    assert.equal(proxy(request(pathname)).headers.get('x-test-next'), 'true')
  }
})

test('existing catalog pagination retains query-preserving 308, 404 and pass behavior', () => {
  const normalized = proxy(request('/catalog?page=1&q=CULTI&brand=CULTI+MILANO'))
  assert.equal(normalized.status, 308)
  assert.equal(normalized.headers.get('location'), 'https://example.test/catalog?q=CULTI&brand=CULTI+MILANO')
  assert.equal(proxy(request('/catalog?page=2')).status, 404)
  assert.equal(proxy(request('/catalog?q=CULTI')).headers.get('x-test-next'), 'true')
})
