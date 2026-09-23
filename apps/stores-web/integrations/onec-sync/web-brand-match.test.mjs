
import test from "node:test";
import assert from "node:assert/strict";
import { matchWebBrandProduct, scoreWebBrandMatch } from "./web-brand-match.mjs";

test("matches AlphaPet by species, weight and recipe signals", () => {
  const local = { name: "AlphaPet WOW д/кош домашних Говядина/Печень 1,5кг (Новый)" };
  const candidates = [
    { title: "AlphaPet WOW с говядиной и печенью для взрослых домашних кошек и котов (1,5 кг)", description: "", matchText: "" },
    { title: "AlphaPet WOW с индейкой для стерилизованных кошек (1,5 кг)", description: "", matchText: "" },
  ];
  const result = matchWebBrandProduct(local, candidates, { threshold: 60, margin: 5 });
  assert.equal(result.ok, true);
  assert.match(result.candidate.title, /говядиной и печенью/);
});

test("rejects package weight mismatch", () => {
  const result = scoreWebBrandMatch(
    "Sirius для собак 2кг",
    { title: "Sirius для собак 15 кг", description: "", matchText: "" },
  );
  assert.equal(result.score, -100);
});

test("rejects ambiguous same-weight candidates", () => {
  const local = { name: "Sirius д/кош 400гр" };
  const candidates = [
    { title: "Sirius для кошек индейка 400 г", description: "", matchText: "" },
    { title: "Sirius для кошек утка 400 г", description: "", matchText: "" },
  ];
  const result = matchWebBrandProduct(local, candidates, { threshold: 40, margin: 10 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "ambiguous");
});
