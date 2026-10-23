const {test}=require('node:test')
const assert=require('node:assert/strict')
require('../scripts/register-typescript.cjs')
const {validateQuoteResponse,fetchOrderDeliveryQuote}=require('../src/commerce/deliveryQuoteClient.ts')
const valid={productTotalMinor:70000,estimatedTotalDeliveryRub:102,estimatedCombinedTotalMinor:80200,estimatedDeliveryDays:5,deliveryIncludedInPayment:false,provisionalLogistics:true}

test('frontend accepts a preliminary Ozon quote only when delivery is excluded from product payment',()=>{
  assert.deepEqual(validateQuoteResponse(valid,70000),{
    estimatedTotalDeliveryRub:102,estimatedCombinedTotalMinor:80200,estimatedDeliveryDays:5,provisionalLogistics:true,
  })
})
test('frontend rejects any mismatch that would misstate product amount or delivery inclusion',()=>{
  for(const invalid of [
    {...valid,productTotalMinor:1},
    {...valid,estimatedCombinedTotalMinor:70000},
    {...valid,estimatedCombinedTotalMinor:80201},
    {...valid,deliveryIncludedInPayment:true},
    {...valid,provisionalLogistics:undefined},
    {...valid,estimatedTotalDeliveryRub:0},
    {...valid,estimatedTotalDeliveryRub:-50},
    {...valid,estimatedDeliveryDays:-3},
    {...valid,estimatedTotalDeliveryRub:Infinity},
  ]) assert.throws(()=>validateQuoteResponse(invalid,70000),/DELIVERY_QUOTE_INVALID/)
})
test('automatic quote does only read-only order estimate; a failed quote stays nonblocking',async()=>{
  let captured
  const fetcher=async(url,options)=>{
    captured={url,options}
    return {ok:true,json:async()=>valid}
  }
  const quote=await fetchOrderDeliveryQuote('example-order-id',70000,fetcher)
  assert.equal(quote.estimatedTotalDeliveryRub,102)
  assert.equal(captured.url,'/api/ozon/delivery-quote')
  assert.equal(captured.options.method,'POST')
  assert.deepEqual(JSON.parse(captured.options.body),{requestId:'example-order-id'})
  await assert.rejects(fetchOrderDeliveryQuote('missing',70000,async()=>({ok:false})),/DELIVERY_QUOTE_UNAVAILABLE/)
})
test('checkout automatically estimates saved orders, clears old pickup selection and discloses separate payment',()=>{
  const fs=require('node:fs')
  const source=fs.readFileSync(require('node:path').join(__dirname,'../components/CheckoutForm.tsx'),'utf8')
  assert.match(source,/setSuccess\(\{ \.\.\.result, deliveryMethod: normalized.delivery.method \}\)[\s\S]{0,180}if \(normalized.delivery.method === 'ozon-pvz'\) void estimateDelivery\(result.id, result.totalMinor\)/)
  assert.match(source,/pvzSearchVersion.current \+= 1[\s\S]{0,150}setSelectedPvz\(null\)/)
  assert.match(source,/version !== pvzSearchVersion.current/)
  assert.match(source,/Доставка оплачивается отдельно после согласования тарифа/)
  assert.match(source,/placeholder="Например, Хабаровск или Владивосток"/)
})
