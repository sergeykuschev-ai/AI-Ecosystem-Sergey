/* eslint-disable @typescript-eslint/no-require-imports -- Node regression tests. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { tileNoteSummary } = require('../src/catalog/tileNotes.ts')
const { noteEvidence, verifiedNotesFor } = require('../src/catalog/verifiedNotes.ts')
const fixture = e => ({
  id: e.sku, isActive: true,
  trade: { sku: e.sku, name: e.aliases[0], brand: e.brand, category: e.category,
    volume: e.volume + (e.category === 'Свечи' ? ' г' : ' мл'), price: 100, stock: 1, barcode: null, characteristics: {} },
  editorial: { slug: e.slug, images: ['/brand/vozdooh-horizontal.webp'], description: null, scentFamily: null, mood: null, room: null, recommendations: [] },
})

test('all six exact bindings show only the first three already-reviewed display notes', () => {
  assert.equal(noteEvidence.length, 6)
  for (const evidence of noteEvidence) {
    const product = fixture(evidence)
    const before = JSON.stringify(product)
    assert.equal(tileNoteSummary(product), verifiedNotesFor(product).displayNotes.slice(0, 3).join(' · '))
    assert.equal(JSON.stringify(product), before)
    for (const patch of [{ sku: 'unknown' }, { brand: 'Other' }, { category: 'Other' },
      { name: 'Unknown' }, { name: 'Not' + evidence.aliases[0] }, { name: evidence.aliases[0] + 'Extra' },
      { volume: null }, { volume: '500 мл' }]) {
      assert.equal(tileNoteSummary({ ...product, trade: { ...product.trade, ...patch } }), null)
    }
    assert.equal(tileNoteSummary({ ...product, editorial: { ...product.editorial, slug: 'wrong' } }), null)
  }
})

test('omit summary for unavailable, unpriced, inactive, unpictured, demo and debug tiles', () => {
  for (const evidence of noteEvidence) {
    const product = fixture(evidence)
    for (const patch of [{ stock: 0 }, { stock: -1 }, { stock: null }, { stock: NaN },
      { price: null }, { price: 0 }, { price: -1 }, { price: NaN }, { price: Infinity }]) {
      assert.equal(tileNoteSummary({ ...product, trade: { ...product.trade, ...patch } }), null)
    }
    assert.equal(tileNoteSummary({ ...product, isActive: false }), null)
    assert.equal(tileNoteSummary({ ...product, editorial: { ...product.editorial, images: [] } }), null)
    assert.equal(tileNoteSummary(product, true), null)
    assert.equal(tileNoteSummary(product, false, true), null)
  }
})

test('card keeps links, events, image and title; notes are plain optional text with no evidence import', () => {
  const card = readFileSync('components/ProductCard.tsx', 'utf8')
  assert.ok(card.includes('href={`/catalog/'))
  assert.ok(card.includes("trackEvent('select_item', productPayload(product))"))
  assert.ok(card.includes("trackEvent('select_merch_item', { item_id: product.trade.sku, section_id: merchSection })"))
  assert.ok(card.includes('title={product.trade.name}'))
  assert.ok(card.includes('alt={product.trade.name}'))
  assert.ok(card.includes('<h3>{display.title}</h3>'))
  assert.ok(card.includes('rub.format(product.trade.price!)'))
  assert.ok(card.includes('!demo && !debug && noteSummary && <p className="productCardNotes">Ноты: {noteSummary}</p>'))
  assert.ok(!/verifiedNotes|fragranceFacts|tileNotes|research/.test(card))
  const css = readFileSync('app/globals.css', 'utf8')
  assert.ok(css.includes('p.productCardNotes{display:block;overflow:visible;-webkit-line-clamp:unset'))
  for (const file of ['app/catalog/page.tsx', 'components/CatalogLanding.tsx', 'app/collections/[slug]/page.tsx']) {
    const source = readFileSync(file, 'utf8')
    assert.ok(source.includes('noteSummary={tileNoteSummary(product'))
    assert.ok(!source.startsWith("'use client'"))
  }
  assert.ok(readFileSync('app/catalog/page.tsx', 'utf8').includes('tileNoteSummary(product, demo, debug)'))
})
