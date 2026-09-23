import test from "node:test";
import assert from "node:assert/strict";
import { composeAwardDescription } from "./award-content.mjs";

test("builds concise dry-food copy from safe official facts", () => {
  const result = composeAwardDescription({
    title: "Сухой корм AWARD для щенков с курицей 2 кг",
    sourceDescription: "Корм содержит пробиотики и пребиотики. Без красителей и консервантов. Используется технология 3NRGY.",
    siteCategory: "Сухой корм",
  });
  assert.equal(
    result,
    "Сухой рацион AWARD для щенков с курицей 2 кг. Содержит пробиотики и пребиотики. Без красителей и консервантов.",
  );
});

test("adds veterinary caution without inventing indication", () => {
  const result = composeAwardDescription({
    title: "Диетический корм AWARD Renal для кошек 1,5 кг",
    sourceDescription: "Содержит таурин.",
    siteCategory: "Ветеринарные диеты",
  });
  assert.match(result, /Содержит таурин/);
  assert.match(result, /по рекомендации ветеринарного специалиста/);
});

test("does not copy unsupported marketing claims", () => {
  const result = composeAwardDescription({
    title: "Влажный корм AWARD для кошек 85 г",
    sourceDescription: "Инновационная формула помогает сделать питомца самым счастливым.",
    siteCategory: "Влажный корм",
  });
  assert.equal(result, "Влажный рацион AWARD для кошек 85 г.");
});
