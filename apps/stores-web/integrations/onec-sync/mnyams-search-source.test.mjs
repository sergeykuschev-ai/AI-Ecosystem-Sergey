import test from "node:test";
import assert from "node:assert/strict";
import { parseMnyamsSearch } from "./mnyams-search-source.mjs";
import { validateMnyamsMatch } from "./mnyams-match.mjs";

test("finds exact Mnyams SKU in search result",()=>{
 const json={results:[{hits:[{document:{sku:"700026",brand:"Мнямс",name:"Лакомство Мнямс с лососем 60 г",slug:"item",image:"https://cdn.test/a.jpg"}}]}]};
 const hit=parseMnyamsSearch(json,"700026");
 assert.equal(hit.sourceUrl,"https://mnyams.ru/product/item");
 assert.equal(hit.searchSourceUrl,"https://mnyams.ru/search/?q=700026");
 assert.equal(hit.brand,"Мнямс");
});
test("rejects reused Mnyams SKU by product attributes",()=>{
 const r=validateMnyamsMatch('Лакомство Мнямс Деликатес "Стриплойн по-английски" для собак 75 г','Лакомство Мнямс Деликатес "Колбаски по-кубински" для собак 130 г');
 assert.equal(r.ok,false);
});
test("accepts exact Mnyams recipe",()=>{
 assert.equal(validateMnyamsMatch('Лакомство Мнямс "Здоровье и красота" хрустящие подушечки для кошек с лососем 60 г','Лакомство Мнямс "Здоровье и красота" хрустящие подушечки для кошек с лососем 60 г').ok,true);
});