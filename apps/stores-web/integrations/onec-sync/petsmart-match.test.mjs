import test from "node:test";
import assert from "node:assert/strict";
import { validatePetsmartVariant } from "./petsmart-match.mjs";

test("accepts exact Savanna volume and aroma", () => {
  assert.equal(validatePetsmartVariant(
    "SAVANNA SANDS 10л лимон наполнитель д/кош",
    "Наполнитель комкующийся для кошек Savanna SANDS 10 л бентонит, с ароматом лимона"
  ).ok, true);
});

test("rejects different Savanna aroma", () => {
  const result = validatePetsmartVariant(
    "SAVANNA ICE 4л цветочный наполнитель д/кош",
    "Наполнитель впитывающий для кошек Savanna ICE 4 л силикагель, с ароматом яблока"
  );
  assert.equal(result.ok, false);
  assert.match(result.reason, /aroma mismatch/);
});

test("accepts exact Mister Napkin size and count", () => {
  assert.equal(validatePetsmartVariant(
    "Мистер Напкин Пеленки впитывающие 60*90см 15шт",
    "Пеленки для кошек и собак Мистер Напкин впитывающие 60*90см 15шт"
  ).ok, true);
});

test("rejects Mister Napkin one piece mapped to ten-pack", () => {
  const result = validatePetsmartVariant(
    "Мистер Напкин Подгузники д/соб XS 2-4 кг, 15-25см 1шт",
    "Подгузники для собак Мистер Напкин размер XS 2-4 кг, 15-25см 10шт"
  );
  assert.equal(result.ok, false);
  assert.match(result.reason, /piece count mismatch/);
});
