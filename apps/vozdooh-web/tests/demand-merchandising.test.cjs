/* eslint-disable @typescript-eslint/no-require-imports -- Node test runner. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { priorityProducts, merchProducts, diverseMerchProducts, merchandisingSignal } = require('../src/catalog/merchandising.ts')
const { applyCatalogFilters, getRecommendations } = require('../src/catalog/filters.ts')
const { stagedEditorial, stagedTrade } = require('../src/catalog/stagedEditorial.ts')
const { fragranceFactsFor } = require('../src/catalog/fragranceFacts.ts')
const { trackEvent } = require('../src/integrations/analytics.ts')
const research = JSON.parse(fs.readFileSync('research/demand-evidence-2026-09.json'))
const trades = research.products.map((p) => stagedTrade({ sku: p.sku, name: p.original_name, stock: p.stock, brand: p.brand, category: '', volume: p.volume, price: null, characteristics: {} }))
const editorial = stagedEditorial(trades)
const products = trades.map((trade) => ({ id: trade.sku, isActive: true, trade, editorial: editorial[trade.sku] }))
const expected = research.products.filter((p) => ['CORE / PRIORITY', 'STRONG'].includes(p.tier)).sort((a,b) => a.promotion_rank-b.promotion_rank)

test('exact priority order, evidence sets and filter stability', () => {
  assert.deepEqual(priorityProducts([...products].reverse()).slice(0,14).map((p) => p.trade.sku), expected.map((p) => p.sku))
  for (const [set, tier] of [['bestsellers','CORE / PRIORITY'], ['strong','STRONG']]) {
    assert.deepEqual(merchProducts(products,set).map((p)=>p.trade.sku),expected.filter((p)=>p.tier===tier).map((p)=>p.sku))
  }
  const ordered = priorityProducts(products)
  const filtered = applyCatalogFilters(ordered,{brand:'CULTI MILANO',category:null,family:null,mood:null,room:null})
  assert.deepEqual(filtered,ordered.filter((p)=>p.trade.brand==='CULTI MILANO'))
  assert.equal(merchProducts(products,'popular').length,14)
  assert.equal(merchProducts(products,'high-stock').length,9)
  assert.equal(merchandisingSignal('BAST500NTFU'),null)
  assert.equal(diverseMerchProducts(merchProducts(products,'bestsellers')).length,2)
  assert.equal(diverseMerchProducts(merchProducts(products,'strong')).length,6)
})

test('all priority cards retain content and exact local assets; car scent has no indoor room claim', () => {
  for (const p of merchProducts(products,'popular')) {
    assert.ok(p.editorial.description,p.trade.sku)
    assert.ok(p.editorial.scentFamily,p.trade.sku)
    assert.ok(p.trade.brand,p.trade.sku)
    assert.ok(p.editorial.images.length,p.trade.sku)
    for (const image of p.editorial.images) assert.ok(fs.statSync(`public${image}`).size>0,image)
    const facts = fragranceFactsFor(p)
    assert.ok(facts?.notes.length,p.trade.sku)
  }
  assert.deepEqual(fragranceFactsFor(products.find((p)=>p.trade.sku==='802e8b0c-d19b-11ec-be83-7c8bca00854e')).rooms,[])
})

test('Aramara, Aqqua and Dolce Vaniglia have reciprocal available format links', () => {
  for (const fragment of ['aramara','aqqua','dolce-vaniglia']) {
    const group = products.filter((p)=>p.editorial.slug.includes(fragment))
    assert.equal(group.length,3)
    for (const p of group) {
      const related = getRecommendations(products,p)
      assert.deepEqual(related.map((p)=>p.trade.sku).sort(),group.filter((q)=>q.id!==p.id).map((q)=>q.trade.sku).sort())
      const unavailable = products.map((q)=>({...q,trade:{...q.trade,stock:q.id===related[0].id?0:q.trade.stock}}))
      assert.ok(getRecommendations(unavailable,p).every((q)=>q.trade.stock>0))
    }
  }
})

test('merch analytics whitelist fields and preserve no-counter no-op', () => {
  const calls=[]
  global.window={__vozdoohAnalyticsId:123,ym:(...args)=>calls.push(args)}
  try {
    for (const event of ['view_merch_section','select_merch_item']) trackEvent(event,{section_id:'popular-fragrances',item_id:'DV250TFU',phone:'private',email:'private',name:'private',comment:'private',event:'override'})
    assert.deepEqual(calls.map((c)=>c[2]),[
      {event:'view_merch_section',section_id:'popular-fragrances'},
      {event:'select_merch_item',section_id:'popular-fragrances',item_id:'DV250TFU'},
    ])
    global.window={}
    const old=process.env.NEXT_PUBLIC_YANDEX_METRICA_ID
    delete process.env.NEXT_PUBLIC_YANDEX_METRICA_ID
    try { trackEvent('view_merch_section',{section_id:'popular-fragrances'});assert.equal(window.__vozdoohAnalyticsPending,undefined) }
    finally { if(old!==undefined)process.env.NEXT_PUBLIC_YANDEX_METRICA_ID=old }
  } finally { delete global.window }
})

const ts=require('typescript')
require.extensions['.tsx']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},fileName:filename}).outputText,filename)
test('homepage renders evidence sections without internal tiers or non-CORE bestseller cards',async()=>{
  const source=require('../src/catalog/source.ts')
  const old=source.getCatalogRepository
  try {
    source.getCatalogRepository=async()=>({list:async()=>products})
    const Home=require('../app/page.tsx').default
    const html=require('react-dom/server').renderToStaticMarkup(await Home())
    assert.match(html,/Бестселлеры брендов/)
    assert.match(html,/не статистика продаж VOZDOOH/)
    assert.doesNotMatch(html,/CORE|STRONG|SLOW|CLEARANCE|promotionRank|demandTier/)
    const block=html.split('id="brand-bestsellers"')[1].split('</section>')[0]
    assert.match(block,/culti-decor-aramara-250/)
    assert.match(block,/culti-stile-tessuto-250/)
    for(const p of merchProducts(products,'strong'))assert.ok(!block.includes(`/catalog/${p.editorial.slug}`),p.trade.sku)
  } finally {source.getCatalogRepository=old}
})
