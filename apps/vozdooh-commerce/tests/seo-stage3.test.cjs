/* eslint-disable @typescript-eslint/no-require-imports -- Node regression tests. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { verifiedNotesFor, noteEvidence } = require('../src/catalog/verifiedNotes.ts')
const { availableCollections, noteCollections, collectionProducts, commercialCollectionsForProduct } = require('../src/catalog/collections.ts')
const { contextualCatalogLinks } = require('../src/catalog/contextualLinks.ts')
const { seasonalGifts } = require('../src/catalog/seasonalGifts.ts')
const fixture = (sku, slug, name, overrides = {}) => ({
  id: sku, isActive: true,
  trade: { sku, name, brand: 'Vellutier', category: 'Свечи', volume: '90 г', price: 100, stock: 1, barcode: null, characteristics: {}, ...overrides },
  editorial: { slug, images: ['/brand/vozdooh-horizontal.webp'], description: null, scentFamily: null, mood: null, room: null, recommendations: [] },
})
const library = fixture('V63017', 'vellutier-vintage-library-90', 'Vellutier Vintage Library 90гр')
const oud = fixture('V63011', 'vellutier-oudwood-journey-90', 'Vellutier Oudwood Journey 90гр')

test('note provenance binds exact SKU, slug, brand, fragrance, category and mass', () => {
  for (const product of [library, oud]) {
    const facts = verifiedNotesFor(product)
    assert.equal(facts.sourceUrl, 'https://vellutier.com/vellutier.pdf')
    assert.equal(facts.verifiedOn, '2026-10-12')
    assert.ok(readFileSync(facts.sourceDocument, 'utf8').includes(product.trade.sku))
    assert.ok(readFileSync(facts.bindingDocument, 'utf8').includes(product.editorial.slug))
    assert.ok(facts.displayNotes.length > 0)
    for (const patch of [{ sku: 'other' }, { brand: 'Other' }, { name: 'Unknown' }, { name: 'Not' + facts.fragrance }, { name: facts.fragrance + 'Extra' }, { category: 'Диффузоры' }, { volume: '515 г' }]) {
      assert.equal(verifiedNotesFor({ ...product, trade: { ...product.trade, ...patch } }), null)
    }
    assert.equal(verifiedNotesFor({ ...product, editorial: { ...product.editorial, slug: 'wrong' } }), null)
  }
  assert.equal(verifiedNotesFor({ ...library, trade: { ...library.trade, name: 'Vintege Library' } }).fragrance, 'Vintage Library')
  assert.equal(noteEvidence.length, 6)
})

test('note routes stay absent below three distinct eligible SKU; unsupported notes never inferred', () => {
  for (const products of [[], [library], [library, oud], [library, library, library]]) {
    assert.ok(!availableCollections(products).some(c => c.rule.field === 'note'))
    assert.deepEqual(commercialCollectionsForProduct(library, products), [])
  }
  for (const patch of [{ stock: 0 }, { stock: null }, { price: null }, { price: 0 }]) {
    const product = { ...library, trade: { ...library.trade, ...patch } }
    for (const collection of noteCollections) assert.deepEqual(collectionProducts([product], collection), [])
  }
  assert.deepEqual(collectionProducts([{ ...library, isActive: false }], noteCollections[0]), [])
  assert.deepEqual(collectionProducts([{ ...library, editorial: { ...library.editorial, images: [] } }], noteCollections[0]), [])
  for (const slug of ['notes-bergamot', 'notes-fig']) {
    assert.deepEqual(collectionProducts([library, oud], noteCollections.find(c => c.slug === slug)), [])
  }
})

test('three exact documented CULTI pairs enable only relevant note routes and links', () => {
  const culti = noteEvidence.filter(e => e.brand === 'CULTI MILANO').map(e => fixture(e.sku, e.slug, e.aliases[0], {
    brand: e.brand, category: e.category, volume: e.volume + ' мл',
  }))
  const destinations = availableCollections(culti).filter(c => c.rule.field === 'note')
  assert.deepEqual(destinations.map(c => c.slug).sort(), ['notes-bergamot', 'notes-sandalwood'])
  assert.deepEqual(destinations.map(c => c.products.length), [3, 3])
  assert.ok(commercialCollectionsForProduct(culti[0], culti).some(c => c.slug === 'notes-bergamot'))
  assert.ok(contextualCatalogLinks([culti[0]], '/collections/example', culti).sections.some(c => c.href === '/collections/notes-bergamot'))
  assert.ok(!availableCollections([culti[0], culti[1], culti[1]]).some(c => c.rule.field === 'note'))
  assert.ok(!availableCollections(culti.slice(1)).some(c => c.rule.field === 'note'))
  for (const patch of [{ stock: 0 }, { price: null }]) {
    const reduced = [{ ...culti[0], trade: { ...culti[0].trade, ...patch } }, ...culti.slice(1)]
    assert.ok(!availableCollections(reduced).some(c => c.rule.field === 'note'))
    assert.ok(!contextualCatalogLinks(culti.slice(1), '/collections/example', reduced).sections.some(c => c.href.startsWith('/collections/notes-')))
  }
  const duplicateSlug = { ...culti[2], editorial: { ...culti[2].editorial, slug: culti[0].editorial.slug } }
  assert.ok(!availableCollections([culti[0], culti[1], duplicateSlug]).some(c => c.rule.field === 'note'))
  for (const p of culti) assert.ok(verifiedNotesFor(p).displayNotes.includes('бергамот'))
})

test('all curated bindings agree with recorded research identities and official evidence', () => {
  const research = JSON.parse(readFileSync('research/demand-evidence-2026-09.json', 'utf8'))
  for (const e of noteEvidence) {
    const row = research.products.find(p => p.sku === e.sku)
    assert.ok(row, e.sku)
    const product = fixture(e.sku, e.slug, row.original_name, { brand: e.brand, category: e.category, volume: row.volume })
    assert.ok(verifiedNotesFor(product), e.sku)
    if (e.brand !== 'Vellutier') {
      assert.ok(row.card_preparation)
      const fact = research.sources.find(s => s.id === row.card_preparation.fact_evidence_id)
      assert.equal(fact.source_role, 'brand')
      assert.equal(fact.checked_at, e.verifiedOn)
      if (fact.url !== e.sourceUrl) assert.ok(readFileSync('research/catalog-cleanup-evidence-2026-09.md', 'utf8').includes(e.sourceUrl))
    }
  }
})

test('contextual relevance keeps both exact pairs when a SKU has multiple slugs', () => {
  const products = ['a', 'b', 'c'].map(sku => fixture(sku, 'decor-' + sku, 'Decor Classic ' + sku, { brand: 'CULTI MILANO', category: 'Диффузоры', volume: '250 мл' }))
  const duplicate = { ...products[0], editorial: { ...products[0].editorial, slug: 'different-slug' } }
  const links = contextualCatalogLinks([products[0], duplicate], '/collections/example', products).sections
  assert.ok(links.some(link => link.href === '/collections/culti-decor'))
  assert.ok(!contextualCatalogLinks([duplicate], '/collections/example', products).sections.some(link => link.href === '/collections/culti-decor'))
})

test('seasonal gifts use current exact pairs and omit unavailable or invalid products', () => {
  const candle = fixture('CAND-XM180', 'teatro-xmas-candle-180', 'TEATRO XMAS', { brand: 'TEATRO Fragranze Uniche', volume: '180 г' })
  const set = fixture('CAPP-XMTFU', 'teatro-xmas-gift-set', 'TEATRO Christmas in Florence', { brand: 'TEATRO Fragranze Uniche', category: 'Подарочные наборы' })
  assert.deepEqual(seasonalGifts([candle, set, candle]), [candle, set])
  assert.deepEqual(seasonalGifts([]), [])
  for (const patch of [{ stock: 0 }, { stock: null }, { price: null }, { brand: 'Other' }, { sku: 'wrong' }]) {
    assert.deepEqual(seasonalGifts([{ ...candle, trade: { ...candle.trade, ...patch } }]), [])
  }
  assert.deepEqual(seasonalGifts([{ ...candle, isActive: false }]), [])
  assert.deepEqual(seasonalGifts([{ ...candle, editorial: { ...candle.editorial, slug: 'wrong' } }]), [])
  assert.deepEqual(seasonalGifts([{ ...candle, editorial: { ...candle.editorial, images: [] } }]), [])
})
