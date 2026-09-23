import test from "node:test";
import assert from "node:assert/strict";
import { composeSibCatDescription } from "./sibcat-content.mjs";

test("builds concise filler description from official facts", () => {
  const text = composeSibCatDescription({
    title: "Супервпитывающий наполнитель «Универсал» 5л",
    composition: "Диатомит",
    advantages: "Высокое влагопоглощение, устранение запахов, экономичен.",
  });
  assert.match(text, /«Универсал» 5л/);
  assert.match(text, /Состав: Диатомит/);
  assert.match(text, /Высокое влагопоглощение/);
});
