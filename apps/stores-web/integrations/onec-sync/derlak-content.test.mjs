import test from "node:test";
import assert from "node:assert/strict";
import { composeDerlakDescription } from "./derlak-content.mjs";

test("builds concise factual treat description", () => {
  const text = composeDerlakDescription({
    title: "Ломтики крольчатины",
    species: "Собаки",
    sourceDescription: "Диетические ломтики. Состав: мясо кролика, минералы. Гарантированные показатели.",
  });
  assert.equal(text, "Лакомство «Деревенские Лакомства» для собак — ломтики крольчатины. Состав: мясо кролика, минералы.");
});
