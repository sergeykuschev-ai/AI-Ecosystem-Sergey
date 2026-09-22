function slugify(value) {
  return value.toLowerCase().replaceAll("ё", "е").replace(/[^a-zа-я0-9]+/giu, "-").replace(/^-+|-+$/g, "");
}
function categoryParents(xml) {
  const result = new Map();
  const token = /<(\/?)Группа(?:\s[^>]*)?>|<Ид>([^<]+)<\/Ид>|<Наименование>([^<]+)<\/Наименование>/g;
  const stack = [];
  let match;
  while ((match = token.exec(xml))) {
    if (match[0].startsWith("<Группа")) stack.push({ id: "", name: "", parentId: stack.at(-1)?.id || null });
    else if (match[0].startsWith("</Группа")) {
      const item = stack.pop();
      if (item?.id && item.name) result.set(item.id, item);
    } else if (stack.length && match[2] && !stack.at(-1).id) stack.at(-1).id = match[2].trim();
    else if (stack.length && match[3] && !stack.at(-1).name) stack.at(-1).name = match[3].trim();
  }
  return result;
}
export function buildCatalogModel(xml, parsed) {
  const hierarchy = categoryParents(xml);
  const categories = parsed.groups.map((g, index) => ({
    externalId: g.externalId,
    parentExternalId: hierarchy.get(g.externalId)?.parentId ?? null,
    name: g.name,
    slug: slugify(g.name) || g.externalId,
    sortOrder: index,
  }));
  const known = new Set(categories.map((c) => c.externalId));
  const products = parsed.products.map((p) => ({
    ...p,
    categoryExternalId: p.groupIds.find((id) => known.has(id)) ?? null,
  }));
  return { categories, products };
}
