import test from "node:test";
import assert from "node:assert/strict";
import { parsePetsmartBrandPage, parsePetsmartProductPage } from "./petsmart-source.mjs";

test("parses exact Petsmart vendor codes from brand page", () => {
  const data = {
    props: { pageProps: { serializedScope: {
      x: { variations: [
        { id: 16908, vendor_code: "КА-00056724", slug: "mister-napkin-6090", name: "Мистер Напкин 60*90 15шт" },
        { id: 16909, vendor_code: "КА-00056723", slug: "mister-napkin-6090", name: "Мистер Напкин 60*90 1шт" },
      ] },
    } } },
  };
  const html = '<script id="__NEXT_DATA__" type="application/json">' + JSON.stringify(data) + "</script>";
  const parsed = parsePetsmartBrandPage(html, "https://petsmart.test/brand");
  assert.equal(parsed.get("КА-00056724").id, 16908);
  assert.equal(parsed.get("КА-00056723").name, "Мистер Напкин 60*90 1шт");
});

test("parses exact Petsmart product and decodes original image", () => {
  const original = "https://petsmart.ru//uploads/images/products/example.jpg";
  const encoded = Buffer.from(original).toString("base64url");
  const data = {
    props: { pageProps: { pageProps: { data: { product: {
      id: 16908,
      vendor_code: "КА-00056724",
      name: "Мистер Напкин 60*90 15шт",
      description: "Описание товара",
      primary_image: { web: { large: [{ url: "https://imgproxy.ru/x/rs:auto:1600:1600/" + encoded }] } },
    } } } } },
  };
  const html = '<script id="__NEXT_DATA__" type="application/json">' + JSON.stringify(data) + "</script>";
  const product = parsePetsmartProductPage(html, "https://petsmart.ru/xabarovsk/product/16908-x");
  assert.equal(product.vendorCode, "КА-00056724");
  assert.equal(product.imageUrl, "https://petsmart.ru//uploads/images/products/example.jpg");
});
