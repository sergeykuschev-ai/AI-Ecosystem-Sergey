import { readFile, writeFile, rename } from "node:fs/promises";
import { parseCommerceMl } from "./parse-commerceml.mjs";
import { buildCatalogModel } from "./catalog-model.mjs";

export async function buildCatalogSnapshot(sourcePath, destinationPath) {
  const xml = await readFile(sourcePath, "utf8");
  const model = buildCatalogModel(xml, parseCommerceMl(xml));
  const snapshot = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: { format: "CommerceML 2.07" },
    counts: { categories: model.categories.length, products: model.products.length },
    categories: model.categories,
    products: model.products,
  };
  const temp = destinationPath + ".tmp";
  await writeFile(temp, JSON.stringify(snapshot), "utf8");
  await rename(temp, destinationPath);
  return snapshot;
}

if (process.argv[1]?.endsWith("catalog-snapshot.mjs")) {
  const [source, destination] = process.argv.slice(2);
  if (!source || !destination) throw new Error("usage: node catalog-snapshot.mjs import.xml snapshot.json");
  const snapshot = await buildCatalogSnapshot(source, destination);
  console.log(JSON.stringify(snapshot.counts));
}
