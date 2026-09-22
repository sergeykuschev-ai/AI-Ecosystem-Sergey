import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCatalogSnapshot } from "./catalog-snapshot.mjs";

test("writes an atomic catalog snapshot", async () => {
  const dir = await mkdtemp(join(tmpdir(), "miska-catalog-"));
  const source = join(dir, "import.xml");
  const target = join(dir, "catalog.json");
  await writeFile(source, `<КоммерческаяИнформация><Группы><Группа><Ид>g1</Ид><Наименование>Кошки</Наименование></Группа></Группы><Товары><Товар><Ид>p1</Ид><Наименование>Корм</Наименование><Группы><Ид>g1</Ид></Группы></Товар></Товары></КоммерческаяИнформация>`);
  const snapshot = await buildCatalogSnapshot(source, target);
  const saved = JSON.parse(await readFile(target, "utf8"));
  assert.deepEqual(snapshot.counts, { categories: 1, products: 1 });
  assert.equal(saved.products[0].categoryExternalId, "g1");
});
