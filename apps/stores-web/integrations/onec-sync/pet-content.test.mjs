import test from "node:test";
import assert from "node:assert/strict";
import { composePetProductDescription } from "./pet-content.mjs";

test("creates concise copy without marketing claim", () => {
  const result = composePetProductDescription({
    title: "Влажный корм Мнямс для кошек 70 г",
    sourceDescription: "Натуральные ингредиенты. Без сои, искусственных красителей и усилителей вкуса. Самый вкусный корм.",
    siteCategory: "Влажный корм",
  });
  assert.equal(
    result,
    "Влажный рацион Мнямс для кошек 70 г. Без сои. Без искусственных красителей. Без усилителей вкуса.",
  );
});

test("keeps veterinary caution", () => {
  const result = composePetProductDescription({
    title: "Ветеринарная диета CRAFTIA GALENA DOG 2 кг",
    sourceDescription: "Легкоусвояемая формула с пребиотиками и клетчаткой.",
    siteCategory: "Ветеринарные диеты",
  });
  assert.match(result, /Содержит пребиотики/);
  assert.match(result, /рекомендации ветеринарного специалиста/);
});
