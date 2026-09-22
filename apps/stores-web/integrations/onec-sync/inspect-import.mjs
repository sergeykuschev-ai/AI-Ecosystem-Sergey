import { parseCommerceMlFile } from "./parse-commerceml.mjs";

const path = process.argv[2];
if (!path) throw new Error("usage: node inspect-import.mjs import.xml");

const data = await parseCommerceMlFile(path);
const duplicateProductIds = data.products.length - new Set(data.products.map((item) => item.externalId)).size;
const productsWithoutGroup = data.products.filter((item) => item.groupIds.length === 0).length;

console.log(JSON.stringify({
  groups: data.groups.length,
  products: data.products.length,
  duplicateProductIds,
  productsWithoutGroup,
  sample: data.products.slice(0, 5),
}, null, 2));
