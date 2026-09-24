import test from "node:test";
import assert from "node:assert/strict";
import { parseMnyamsSearch } from "./mnyams-search-source.mjs";
import { validateMnyamsMatch } from "./mnyams-match.mjs";

test("finds exact Mnyams SKU in search result",()=>{
 const json={results:[{hits:[{document:{sku:"700026",name:"Лакомство Мнямс с лососем 60 г",slug:"item",image:"https://cdn.test/a.jpg"}}]}]};
 assert.equal(parseMnyamsSearch(json,"700026").sourceUrl,"https://mnyams.ru/product/item");
});
test("rejects reused Mnyams SKU by product attributes",()=>{
 const r=validateMnyamsMatch('Лакомство Мнямс Деликатес "Стриплойн по-английски" для собак 75 г','Лакомство Мнямс Деликатес "Колбаски по-кубински" для собак 130 г');
 assert.equal(r.ok,false);
});
test("accepts exact Mnyams recipe",()=>{
 assert.equal(validateMnyamsMatch('Лакомство Мнямс "Здоровье и красота" хрустящие подушечки для кошек с лососем 60 г','Лакомство Мнямс "Здоровье и красота" хрустящие подушечки для кошек с лососем 60 г').ok,true);
});