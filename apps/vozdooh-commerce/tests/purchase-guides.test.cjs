/* eslint-disable @typescript-eslint/no-require-imports -- Public identities with synthetic price/stock. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { reviewedPurchaseGuide, purchaseGuideAlternatives } = require('../src/catalog/purchaseGuides.ts')
const { withValidImages } = require('../src/catalog/validImages.ts')
const identities = [
  ['9a227639-b1a0-11ed-a1a3-7c8bca00854e','aromagroup-cleaning-fluid-110','Жидкость для промывки картридж AG 110мл пласт.','AROMAgroup','Ароматизация помещений','110 мл'],
  ['4356','aromagroup-cleaning-fluid-150','Жидкость для промывки картридж AG 150мл пласт.','AROMAgroup','Ароматизация помещений','150 мл'],
  ['76544','aromagroup-magma-100','Магма картридж AG 100мл пласт.','AROMAgroup','Ароматизация помещений','100 мл'],
  ['3444567','aromagroup-dzhovanni-150','Джованни картридж AG 150мл пласт.','AROMAgroup','Ароматизация помещений','150 мл'],
  ['fa750378-783b-11ed-b530-7c8bca00854e','aromagroup-dispenser-liquid-white','Аппарат для ароматизации помещений AROMAgroup Dispenser Liquid bt V3.1 (белый)','AROMAgroup','Ароматизация помещений',null],
  ['MF-REFILL.08','mami-coccole-di-talco-refill-250','MAMI MILANO Рефилл для диффузора COCCOLE DI TALCO / Пудровые объятия. Коллекция PALAZZO, 250 мл','MAMI MILANO','Рефилы','250 мл'],
]
const make = ([sku,slug,name,brand,category,volume]) => ({id:sku,isActive:true,trade:{sku,name,brand,category,volume,stock:1,price:100,barcode:null,characteristics:{}},editorial:{slug,images:['/synthetic.webp'],description:null,scentFamily:null,mood:null,room:null,recommendations:[]}})

test('six exact products receive distinct, factual commercial metadata and readable questions',()=>{
  const titles=new Set(), descriptions=new Set()
  for(const identity of identities){
    const p=make(identity), before=JSON.stringify(p), guide=reviewedPurchaseGuide(p)
    assert.ok(guide); assert.equal(guide.questions.length,3)
    assert.ok(guide.title.includes(p.trade.brand)); if(p.trade.volume) assert.ok(guide.title.includes(p.trade.volume))
    assert.ok(guide.title.length<=95); assert.ok(guide.description.length<=170,guide.description.length)
    assert.ok(guide.questions.every(item=>item.question && item.answer))
    assert.doesNotMatch(JSON.stringify(guide),/бестселлер|хит продаж|бесплатная доставка|рейтинг|гарантия|\d+\s*м²/i)
    titles.add(guide.title);descriptions.add(guide.description);assert.equal(JSON.stringify(p),before)
  }
  assert.equal(titles.size,6);assert.equal(descriptions.size,6)
})

test('changed identity and unreviewed products never inherit guide or metadata',()=>{
  for(const identity of identities){
    const p=make(identity)
    for(const [key,value] of [['sku','unreviewed'],['name','Changed import'],['brand','Other'],['category','Other'],['volume','999 мл']]){
      assert.equal(reviewedPurchaseGuide({...p,trade:{...p.trade,[key]:value}}),null,key)
    }
    assert.equal(reviewedPurchaseGuide({...p,editorial:{...p.editorial,slug:'other'}}),null)
  }
})

test('unavailable, inactive, unpriced and unpictured products have no commercial guide',()=>{
  const p=make(identities[0])
  for(const stock of [0,-1,null,NaN,Infinity]) assert.equal(reviewedPurchaseGuide({...p,trade:{...p.trade,stock}}),null)
  for(const price of [0,-1,null,NaN,Infinity]) assert.equal(reviewedPurchaseGuide({...p,trade:{...p.trade,price}}),null)
  assert.equal(reviewedPurchaseGuide({...p,isActive:false}),null)
  assert.equal(reviewedPurchaseGuide({...p,editorial:{...p.editorial,images:[]}}),null)
})

test('missing image files are removed before guide selection',async()=>{
  const p=make(identities[0]);p.editorial.images=['/nonexistent-purchase-guide-fixture.webp']
  assert.equal(reviewedPurchaseGuide((await withValidImages([p]))[0]),null)
})

test('cleaning alternatives link only eligible opposite volume, never apparatus or aromatic cartridges',()=>{
  const products=identities.map(make),before=JSON.stringify(products)
  assert.deepEqual(purchaseGuideAlternatives(products,products[0]).map(p=>p.trade.sku),['4356'])
  assert.deepEqual(purchaseGuideAlternatives(products,products[1]).map(p=>p.trade.sku),[products[0].trade.sku])
  assert.deepEqual(purchaseGuideAlternatives(products.map(p=>({...p,trade:{...p.trade,stock:0}})),products[0]),[])
  assert.deepEqual(purchaseGuideAlternatives(products,{...products[0],trade:{...products[0].trade,name:'renamed'}}),[])
  assert.deepEqual(purchaseGuideAlternatives([],products[0]),[])
  for(const p of products.slice(2)) assert.deepEqual(purchaseGuideAlternatives(products,p),[])
  assert.equal(JSON.stringify(products),before)
})

test('MAMI guide distinguishes a stick diffuser refill and makes no equipment compatibility promise',()=>{
  const guide=reviewedPurchaseGuide(make(identities[5]))
  assert.match(guide.intro,/диффузора с палочками/)
  assert.match(guide.questions[1].answer,/лимон и нероли/)
  assert.equal(guide.helpHref,'/guides/refil-dlya-diffuzora-kak-ispolzovat')
  assert.doesNotMatch(JSON.stringify(guide),/каталитическ|ультразвук|любого аппарата/i)
})
