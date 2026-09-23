import test from "node:test";
import assert from "node:assert/strict";
import { composeZooFortunaDescription } from "./zoofortuna-content.mjs";

test("builds concise clothing copy from official facts", () => {
  const result = composeZooFortunaDescription({
    title: "Комбинезон на флисе МОПС кобель (31 см)",
    sourceDescription: "РАЗМЕР: длина спины 31 см, обхват шеи 42 см, обхват груди 58 см, обхват талии 50 см. Подкладка из флиса. Застежка на спине: молния. Светоотражающий кант. Произведено в России.",
  });
  assert.match(result, /длина спины — 31 см/);
  assert.match(result, /шея — 42 см/);
  assert.match(result, /Подкладка из флиса/);
  assert.match(result, /светоотражающие элементы/);
  assert.doesNotMatch(result, /рекомендован для осенней/);
});

test("falls back to official title when no structured facts exist", () => {
  assert.equal(
    composeZooFortunaDescription({ title: "Жилет для собак, размер 25", sourceDescription: "" }),
    "Жилет для собак, размер 25.",
  );
});
