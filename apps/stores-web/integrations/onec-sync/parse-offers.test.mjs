import test from "node:test";
import assert from "node:assert/strict";
import {
  MISKA_PRICE_TYPE_ID,
  MISKA_WAREHOUSE_ID,
  parseOffersCommerceMl,
} from "./parse-offers.mjs";

function offer({ id = "p1", miskaPrice = "306", vozdoohPrice = "9999", stock = "2" } = {}) {
  return `<КоммерческаяИнформация><ПакетПредложений><Предложения>
    <Предложение><Ид>${id}</Ид><Цены>
      <Цена><ИдТипаЦены>wrong-price</ИдТипаЦены><ЦенаЗаЕдиницу>${vozdoohPrice}</ЦенаЗаЕдиницу></Цена>
      <Цена><ИдТипаЦены>${MISKA_PRICE_TYPE_ID}</ИдТипаЦены><ЦенаЗаЕдиницу>${miskaPrice}</ЦенаЗаЕдиницу></Цена>
    </Цены>
    <Склад ИдСклада="wrong-warehouse" КоличествоНаСкладе="77"/>
    <Склад ИдСклада="${MISKA_WAREHOUSE_ID}" КоличествоНаСкладе="${stock}"/>
    </Предложение></Предложения></ПакетПредложений></КоммерческаяИнформация>`;
}
test("uses only Miska price and Miska warehouse", () => {
  const result = parseOffersCommerceMl(offer());
  assert.deepEqual(result.offers, [{
    externalId: "p1", price: 306, stockQuantity: 2, rawStockQuantity: 2,
  }]);
});

test("zero price becomes null instead of a public zero price", () => {
  assert.equal(parseOffersCommerceMl(offer({ miskaPrice: "0" })).offers[0].price, null);
});

test("negative stock is preserved for diagnostics but clamped for website availability", () => {
  const parsed = parseOffersCommerceMl(offer({ stock: "-3" })).offers[0];
  assert.equal(parsed.rawStockQuantity, -3);
  assert.equal(parsed.stockQuantity, 0);
});

test("fractional stock is preserved", () => {
  assert.equal(parseOffersCommerceMl(offer({ stock: "0.8" })).offers[0].stockQuantity, 0.8);
});
test("rejects missing target price", () => {
  const xml = offer().replaceAll(MISKA_PRICE_TYPE_ID, "another-price");
  assert.throws(() => parseOffersCommerceMl(xml), /0 target prices/);
});

test("rejects missing target warehouse", () => {
  const xml = offer().replaceAll(MISKA_WAREHOUSE_ID, "another-warehouse");
  assert.throws(() => parseOffersCommerceMl(xml), /0 target warehouse rows/);
});

test("rejects duplicate offer ids", () => {
  const body = offer().match(/<Предложение>[\s\S]*?<\/Предложение>/)[0];
  const xml = `<КоммерческаяИнформация><ПакетПредложений><Предложения>${body}${body}</Предложения></ПакетПредложений></КоммерческаяИнформация>`;
  assert.throws(() => parseOffersCommerceMl(xml), /duplicate offer id/);
});
