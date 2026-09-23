import test from "node:test";
import assert from "node:assert/strict";
import { sourceUrlForLocalName, parseSibCatProductPage } from "./sibcat-source.mjs";

test("maps known filler family and volume to official url", () => {
  assert.equal(
    sourceUrlForLocalName("Сибирская Кошка Наполнитель д/кош Лесной древесный 10л"),
    "https://sibirskayakoshka.ru/katalog/supervpityvayushchij-drevesnyj-napolnitel-lesnoj-10l",
  );
  assert.equal(
    sourceUrlForLocalName("Сибирская Кошка Наполнитель д/кош Супер комкующийся 7л"),
    "https://sibirskayakoshka.ru/katalog/komkuyushchijsya-napolnitel-super-7l",
  );
});

test("does not guess unsupported product type", () => {
  assert.equal(sourceUrlForLocalName("Сибирская кошка Туалет Премиум с сеткой"), null);
});

test("parses official product page", () => {
  const html = `
  <div class="product__gallery-items"><div><img src="https://img/item.jpg"></div></div>
  <h1 class="product__title h1">Супервпитывающий наполнитель «Универсал» 5л</h1>
  <div class="product__char-title">Состав:</div><div class="product__char-text">Диатомит</div>
  <div class="product__char-title">Преимущества:</div><div class="product__char-text">Высокое влагопоглощение, устранение запахов</div>
  <div class="product__descr"><div>Описание:</div><p>Минеральный наполнитель.</p></div>
  `;
  const product = parseSibCatProductPage(html, "https://sibirskayakoshka.ru/katalog/x");
  assert.equal(product.title, "Супервпитывающий наполнитель «Универсал» 5л");
  assert.equal(product.composition, "Диатомит");
  assert.equal(product.imageUrl, "https://img/item.jpg");
});
