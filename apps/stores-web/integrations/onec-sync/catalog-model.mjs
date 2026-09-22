function slugify(value) {
  return value.toLowerCase().replaceAll("ё", "е").replace(/[^a-zа-я0-9]+/giu, "-").replace(/^-+|-+$/g, "");
}

function parseGroupTree(xml) {
  const result = [];
  const stack = [];
  const token = /<Группа(?:\s[^>]*)?>|<\/Группа>|<Ид>([^<]+)<\/Ид>|<Наименование>([^<]+)<\/Наименование>/g;
  let match;
  while ((match = token.exec(xml))) {
    if (match[0].startsWith("<Группа")) {
      stack.push({ externalId: "", name: "", parentExternalId: stack.at(-1)?.externalId || null });
    } else if (match[0] === "</Группа>") {
      const item = stack.pop();
      if (item?.externalId && item.name) result.push(item);
    } else if (stack.length && match[1] && !stack.at(-1).externalId) {
      stack.at(-1).externalId = match[1].trim();
      for (let i = stack.length - 2; i >= 0; i--) {
        if (stack[i].externalId) { stack.at(-1).parentExternalId = stack[i].externalId; break; }
      }
    } else if (stack.length && match[2] && !stack.at(-1).name) {
      stack.at(-1).name = match[2].trim();
    }
  }
  return result;
}

export function buildCatalogModel(xml, parsed) {
  const tree = parseGroupTree(xml);
  const hierarchy = new Map(tree.map((item) => [item.externalId, item]));
  const usedSlugs = new Set();
  const categories = parsed.groups.map((group, index) => {
    const baseSlug = slugify(group.name) || group.externalId;
    let slug = baseSlug;
    for (let suffix = 2; usedSlugs.has(slug); suffix++) {
      slug = `${baseSlug}-${suffix}`;
    }
    usedSlugs.add(slug);
    return {
      externalId: group.externalId,
      parentExternalId: hierarchy.get(group.externalId)?.parentExternalId ?? null,
      name: group.name,
      slug,
      sortOrder: index,
    };
  });
  const known = new Set(categories.map((item) => item.externalId));
  const products = parsed.products.map((product) => ({
    ...product,
    categoryExternalId: product.groupIds.find((id) => known.has(id)) ?? null,
  }));
  return { categories, products };
}
