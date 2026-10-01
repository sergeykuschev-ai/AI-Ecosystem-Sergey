// Exact catalog labels reviewed against the v5 commercial ownership map.
// Unknown or broad labels stay unlinked; never derive a landing URL from CMS text.
const owners: Record<string, Record<string, string>> = {
  amper: {
    "Товары для электромонтажа": "elektromontazhnye-tovary",
    "Освещение": "osveshchenie",
    "Электроинструмент": "elektroinstrument",
  },
  ventil: {
    "Отопление": "otoplenie",
    "Арматура": "zapornaya-armatura",
    "Смесители": "smesiteli",
    "Канализация": "kanalizaciya",
  },
  "metiz-market": {
    "Саморезы": "samorezy",
    "Болты": "bolty-gayki-shayby",
    "Гайки": "bolty-gayki-shayby",
    "Анкеры": "ankery-i-dyubeli",
    "Дюбели": "ankery-i-dyubeli",
  },
  miska: {
    "Корма": "korm-dlya-koshek-i-sobak",
    "Лакомства": "lakomstva",
    "Наполнители и туалеты": "napolniteli-i-tualety",
    "Уход": "uhod-i-gigiena",
    "Игрушки": "igrushki-i-amuniciya",
    "Амуниция": "igrushki-i-amuniciya",
  },
};

/** Return the reviewed owner for an exact brand/label pair, or no link. */
export function getStoreCategoryHref(brandSlug: string, categoryName: string): string | undefined {
  if (!Object.hasOwn(owners, brandSlug)) return undefined;
  const categories = owners[brandSlug];
  if (!Object.hasOwn(categories, categoryName)) return undefined;
  return `/${brandSlug}/${categories[categoryName]}/`;
}