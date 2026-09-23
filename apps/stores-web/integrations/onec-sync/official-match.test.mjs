import test from "node:test";
import assert from "node:assert/strict";
import { validateOfficialMatch } from "./official-match.mjs";

test("accepts abbreviated name when weight and species agree", () => {
  assert.equal(validateOfficialMatch(
    "Влажный корм Мнямс кусочки с ягн для кошек 85г",
    "Влажный корм Мнямс На каждый день кусочки с ягненком для кошек 85 г",
  ).ok, true);
});

test("rejects reused SKU with different package weight", () => {
  const result = validateOfficialMatch(
    'Лакомство Мнямс Деликатес "Стриплойн по-английски" для собак 75 г',
    'Лакомство Мнямс Деликатес "Колбаски по-кубински" для собак 130 г',
  );
  assert.equal(result.ok, false);
  assert.match(result.reason, /weight mismatch/);
});

test("rejects assortment mapped to one flavor", () => {
  assert.equal(validateOfficialMatch(
    "Крем-лакомство Мнямс для кошек ассорти 15 г по шт",
    "Крем-лакомство Мнямс для кошек с тунцом 15 г",
  ).ok, false);
});

test("rejects cat/dog mismatch", () => {
  assert.equal(validateOfficialMatch("Лакомство для кошек 50 г", "Лакомство для собак 50 г").ok, false);
});
