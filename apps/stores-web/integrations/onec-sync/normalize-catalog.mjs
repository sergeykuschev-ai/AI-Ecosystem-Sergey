const ROOT = "МИСКА ЗООТОВАРЫ";

function lower(value) {
  return String(value ?? "").toLocaleLowerCase("ru-RU");
}

function includesAny(text, values) {
  return values.some((value) => text.includes(value));
}

function categoryPath(categoryId, byId) {
  const result = [];
  const seen = new Set();
  let category = categoryId ? byId.get(categoryId) : undefined;
  while (category && !seen.has(category.externalId)) {
    seen.add(category.externalId);
    result.unshift(category.name);
    category = category.parentExternalId ? byId.get(category.parentExternalId) : undefined;
  }
  return result;
}

function explicitSpecies(name) {
  const n = lower(name);
  const matches = [];
  if (/кош|котят|\bкот\b|feline/.test(n)) matches.push("Кошки");
  if (/собак|щен|кобел|canine/.test(n)) matches.push("Собаки");
  if (/грыз|хомяк|хорьк|морск.*свин/.test(n)) matches.push("Грызуны");
  if (/птиц|попуг|канар|жерд/.test(n)) matches.push("Птицы");
  if (/аквари|\bрыб|для рыб/.test(n)) matches.push("Рыбы");
  if (/рептил|террари/.test(n)) matches.push("Рептилии");
  return [...new Set(matches)];
}
function inferSection(path, name, category) {
  if (path.includes("Рептилии")) return { value: "Рептилии", confidence: 100, reason: "source-path" };
  for (const section of ["Кошки", "Собаки", "Грызуны", "Птицы", "Рыбы"]) {
    if (path.includes(section)) return { value: section, confidence: 100, reason: "source-path" };
  }
  if (path.includes("Аптека") || path.includes("Попоны/Воротники")) {
    return { value: "Ветаптека", confidence: 100, reason: "source-path" };
  }

  const species = explicitSpecies(name);
  if (species.length === 1) return { value: species[0], confidence: 88, reason: "product-name" };
  if (species.includes("Кошки") && species.includes("Собаки")) {
    return { value: "Кошки и собаки", confidence: 88, reason: "product-name" };
  }

  if (["Одежда и обувь", "Пелёнки и подгузники", "Амуниция"].includes(category)) {
    return { value: "Собаки", confidence: 78, reason: "category-hint" };
  }
  if (["Наполнители", "Когтеточки", "Туалеты"].includes(category)) {
    return { value: "Кошки", confidence: 78, reason: "category-hint" };
  }
  if (["Аквариумное оборудование", "Аквариумная химия"].includes(category)) {
    return { value: "Рыбы", confidence: 90, reason: "category-hint" };
  }
  if (category === "Клетки" && /хомяк|грыз/.test(lower(name))) {
    return { value: "Грызуны", confidence: 88, reason: "category-hint" };
  }
  if (category === "Аксессуары" && /жерд|лесниц|гнезд|треугольник|дуга/.test(lower(name))) {
    return { value: "Птицы", confidence: 82, reason: "category-hint" };
  }
  if (["Игрушки", "Миски и поилки", "Уход и гигиена", "Лежаки и домики", "Переноски и путешествия", "Лакомства", "Хранение корма", "Гигиенические аксессуары"].includes(category)) {
    return { value: "Кошки и собаки", confidence: 75, reason: "universal-category" };
  }
  return { value: "Кошки и собаки", confidence: 55, reason: "universal-fallback" };
}
function pharmacyCategory(name) {
  const n = lower(name);
  if (/блох|клещ|гельминт|празител|дирофен|милпразон|inspector|барс/.test(n)) return "Противопаразитарные средства";
  if (/protexin|проколин|синбиот|лактобиф|пробиот/.test(n)) return "Пищеварение и пробиотики";
  if (/relaxivet|успоко|стоп-проблем/.test(n)) return "Успокоительные средства";
  if (/кож|стоп-зуд/.test(n)) return "Кожа и шерсть";
  if (/контрсекс|полов.*охот/.test(n)) return "Регуляция полового поведения";
  return "Ветпрепараты";
}

function inferCategory(path, name) {
  const p = lower(path.join(" > "));
  const n = lower(name);
  if (path.includes("Аптека")) return { value: pharmacyCategory(name), confidence: 95 };
  if (path.includes("Попоны/Воротники") || /попона послеоперац|воротник защит/.test(n)) return { value: "Послеоперационный уход", confidence: 95 };

  const messySource = ["Китай", "23250", "На развес", "По штучно", "Средства ухода и содержания", "Одежда", "Поилки"].some((item) => path.includes(item));
  if (messySource) {
    if (/переноск/.test(n)) return { value: "Переноски и путешествия", confidence: 88 };
    if (/дождевик|комбинезон|пуховик|жилетк|кофта|ботин|шапочк|носки|плать|костюм/.test(n)) return { value: "Одежда и обувь", confidence: 86 };
    if (/ошейник|поводок|шлейк|рулетк|намордник|адресник/.test(n)) return { value: "Амуниция", confidence: 88 };
    if (/пеленк|подгуз|трусы для собак|пояс для кобел|мистер напкин/.test(n)) return { value: "Пелёнки и подгузники", confidence: 88 };
    if (/шампун|кондиционер|когтерез|пуходерк|расчес|расчёс|колтунорез|чесалк|зубн.*паст|крем.*лап|полотенц|лайна|варежк|перчатк/.test(n)) return { value: "Уход и гигиена", confidence: 84 };
    if (/миска|блюдце|кормушк|поилк|поильник|бутылка дорож/.test(n)) return { value: "Миски и поилки", confidence: 84 };
    if (/клетк/.test(n)) return { value: "Клетки", confidence: 86 };
    if (/контейнер.*корм/.test(n)) return { value: "Хранение корма", confidence: 82 };
    if (/когтеточ/.test(n)) return { value: "Когтеточки", confidence: 86 };
    if (/пакет гигиен/.test(n)) return { value: "Гигиенические аксессуары", confidence: 82 };
    if (/лежан|матрас|домик/.test(n)) return { value: "Лежаки и домики", confidence: 84 };
    if (/лакомств|кость.*жил|палочк|рубец|легкое|кишки|фрост/.test(n)) return { value: "Лакомства", confidence: 86 };
    if (/сухой корм|grandorf|краф.*разс/.test(n)) return { value: "Сухой корм", confidence: 76 };
    if (/корм д\/череп|корм для череп|тортила.*корм/.test(n)) return { value: "Корм", confidence: 88 };
    if (/кальций/.test(n)) return { value: "Витамины и добавки", confidence: 82 };
    if (/бутылка резинов|игруш|мяч|фрисби|мыш[ьи]|пирамид|пищалк|кольц|канат|шар|кость.*резин|лазер|жук.*интеракт|курица|крокодил|осьминог|дразнилк|пистолет/.test(n)) return { value: "Игрушки", confidence: 82 };
    if (/жерд|лесниц|дуга.*птиц|гнездо|треугольник.*птиц/.test(n)) return { value: "Аксессуары", confidence: 78 };
    if (/грабл/.test(n)) return { value: "Уход и гигиена", confidence: 72 };
    if (/кросовк|обувь/.test(n)) return { value: "Одежда и обувь", confidence: 82 };
  }
  if (p.includes("лечебный и ветеринарный корм")) return { value: "Ветеринарные диеты", confidence: 100 };
  if (p.includes("сухой корм")) return { value: "Сухой корм", confidence: 100 };
  if (includesAny(p, ["влажный корм", " > консервы", " > пауч"])) return { value: "Влажный корм", confidence: 100 };
  if (p.includes("лакомства")) return { value: "Лакомства", confidence: 100 };
  if (/лакомств|кость.*жил|палочк.*мяс|рубец|легкое|кишки/.test(n)) return { value: "Лакомства", confidence: 82 };
  if (p.includes("корм для") || p.includes("корм и подкормка")) return { value: "Корм", confidence: 95 };
  if (!messySource && p.includes("игрушк")) return { value: "Игрушки", confidence: 100 };
  if (/игруш|мяч|фрисби|мыш[ьи]|пирамидак|пищалк/.test(n)) return { value: "Игрушки", confidence: 82 };

  if (p.includes("амуниция") || /ошейник|поводок|шлейк|рулетк|намордник|адресник/.test(n)) return { value: "Амуниция", confidence: p.includes("амуниция") ? 100 : 85 };
  if (p.includes("лежак") || p.includes("домик")) return { value: "Лежаки и домики", confidence: 100 };
  if (/лежан|матрас|домик/.test(n)) return { value: "Лежаки и домики", confidence: 82 };
  if (p.includes("миски, кормушки, поилки") || path.includes("Поилки") || /миска|блюдце|кормушк|поилк|бутылка дорож/.test(n)) return { value: "Миски и поилки", confidence: 92 };
  if (p.includes("наполнител")) return { value: "Наполнители", confidence: 100 };
  if (p.includes("лотки") || p.includes("туалеты")) return { value: "Туалеты", confidence: 100 };
  if (/лоток|туалет|совок/.test(n)) return { value: "Туалеты", confidence: 80 };
  if (p.includes("когтеточ") || /когтеточ/.test(n)) return { value: "Когтеточки", confidence: p.includes("когтеточ") ? 100 : 86 };
  if (p.includes("средства от блох") || p.includes("защита от блох")) return { value: "Противопаразитарные средства", confidence: 100 };
  if (p.includes("витамины")) return { value: "Витамины и добавки", confidence: 100 };
  if (p.includes("коррекция поведения")) return { value: "Коррекция поведения", confidence: 100 };
  if (p.includes("сумки, переноски") || /переноск/.test(n)) return { value: "Переноски и путешествия", confidence: p.includes("перенос") ? 100 : 82 };
  if (/контейнер.*корм/.test(n)) return { value: "Хранение корма", confidence: 86 };
  if (p.includes("пеленки") || /пеленк|подгуз|трусы для собак|пояс для кобел/.test(n)) return { value: "Пелёнки и подгузники", confidence: 95 };
  if (p.includes("одежда") || /дождевик|комбинезон|пуховик|жилетк|кофта|ботин|шапочк/.test(n)) return { value: "Одежда и обувь", confidence: 92 };

  if (p.includes("груминг") || p.includes("гигиены и косметика") || /шампун|кондиционер|когтерез|пуходерк|расчес|расчёс|зубн.*паст|крем.*лап|полотенц/.test(n)) {
    return { value: "Уход и гигиена", confidence: 92 };
  }
  if (p.includes("клетки")) return { value: "Клетки", confidence: 100 };
  if (path.includes("Рептилии") && /корм/.test(n)) return { value: "Корм", confidence: 90 };
  if (path.includes("Рептилии") && /кальций|витамин/.test(n)) return { value: "Витамины и добавки", confidence: 88 };
  if (p.includes("аквариумная химия")) return { value: "Аквариумная химия", confidence: 100 };
  if (p.includes("оборудование для рыб") || p.includes("аквариумы и тумбы")) return { value: "Аквариумное оборудование", confidence: 100 };
  if (path.includes("Средства ухода и содержания")) return { value: "Уход и гигиена", confidence: 70 };
  return { value: "Прочее", confidence: 35 };
}

function inferSubcategory(category, name) {
  const n = lower(name);
  if (category === "Амуниция") {
    if (/ошейник/.test(n)) return "Ошейники";
    if (/поводок/.test(n)) return "Поводки";
    if (/шлейк/.test(n)) return "Шлейки";
    if (/рулетк/.test(n)) return "Рулетки";
    if (/намордник/.test(n)) return "Намордники";
    if (/адресник/.test(n)) return "Адресники";
  }
  if (category === "Уход и гигиена") {
    if (/шампун/.test(n)) return "Шампуни";
    if (/кондиционер/.test(n)) return "Кондиционеры";
    if (/когтерез/.test(n)) return "Когтерезы";
    if (/расчес|расчёс|пуходерк/.test(n)) return "Расчёски и пуходёрки";
  }
  return null;
}
function inferBrand(path, name) {
  const haystacks = [...path, name].map(lower);
  for (const [brand, aliases] of BRAND_ALIASES) {
    if (aliases.some((alias) => haystacks.some((text) => text.includes(alias)))) return brand;
  }
  return null;
}

export function classifyProduct(product, categories) {
  const byId = categories instanceof Map ? categories : new Map(categories.map((item) => [item.externalId, item]));
  const path = categoryPath(product.categoryExternalId, byId);
  const category = inferCategory(path, product.name);
  const section = inferSection(path, product.name, category.value);
  const brand = inferBrand(path, product.name);
  const confidence = Math.min(section.confidence, category.confidence);
  return {
    externalId: product.externalId,
    sourcePath: path.filter((item) => item !== ROOT).join(" > "),
    siteSection: section.value,
    siteCategory: category.value,
    siteSubcategory: inferSubcategory(category.value, product.name),
    brand,
    classificationConfidence: confidence,
    classificationStatus: confidence >= 70 && category.value !== "Прочее" ? "auto" : "review",
    classificationReason: `${section.reason}; category=${category.value}`,
  };
}

export function classifyCatalog(snapshot) {
  const byId = new Map(snapshot.categories.map((item) => [item.externalId, item]));
  return snapshot.products.map((product) => classifyProduct(product, byId));
}

const BRAND_ALIASES = [
  ["Petstages", ["petstages"]],
  ["Red Dingo", ["reddingo", "red dingo"]],
  ["IMAC", ["imac "]],
  ["Mr.Alex", ["mr.alex", "mr alex"]],
  ["Фармавит NEO", ["фармавит neo", "фармавит"]],
  ["CO PET", ["co pet"]],
  ["Деревенские Лакомства", ["деревенские лакомства"]],
  ["Ферма кота Федора", ["ферма кота федора"]],
  ["Сибирская кошка", ["сибирская кошка"]],
  ["Cat's Choice", ["cat's choice", "cats choice"]],
  ["Момент счастья", ["момент счастья"]],
  ["Bambini Pets", ["bambini pets", "bambini"]],
  ["Neoterica Vetpro", ["neoterica vetpro", "neoterica"]],
  ["VitaVet Pro", ["vitavet pro", "vitavet"]],
  ["Мистер Напкин", ["мистер напкин"]],
  ["Айда Гулять!", ["айда гулять"]],
  ["Dog&Vogue", ["dog&vogue"]],
  ["Little One", ["little one"]],
  ["Happy Jungle", ["happy jungle"]],
  ["Animal Play", ["animal play"]],
  ["Chewy Snax", ["chewy snax"]],
  ["Doctor VIC", ["doctor vic"]],
  ["All For", ["all for"]],
  ["Mr.Kranch", ["mr.kranch", "mr kranch"]],
  ["Mr.Bruno", ["mr.bruno", "mr bruno"]],
  ["AlphaPet", ["alphapet", "alpha pet"]],
  ["Craftia", ["craftia", "крафтия"]],
  ["Grandorf", ["grandorf"]],
  ["AWARD", ["award"]],
  ["Мнямс", ["мнямс"]],
  ["Sirius", ["sirius"]],
  ["Royal", ["royal"]],
  ["Hill's", ["hill's", "hills"]],
  ["INABA", ["inaba"]],
  ["Ranova", ["ranova"]],
  ["Titbit", ["titbit"]],
  ["Winner", ["winner", "мираторг"]],
  ["Savanna", ["savanna"]],
  ["Tetra", ["tetra"]],
  ["Aquacons", ["aquacons"]],
  ["Зоомир", ["зоомир"]],
  ["Аркон", ["аркон"]],
  ["GiGwi", ["gigwi"]],
  ["Pawise", ["pawise"]],
  ["Keiko", ["keiko"]],
  ["Unitabs", ["unitabs"]],
  ["Flexi", ["flexi"]],
  ["Triol", ["triol"]],
  ["Good Cat", ["good cat"]],
  ["Yoriki", ["yoriki"]],
  ["ISB", ["isb"]],
  ["Inspector", ["inspector"]],
  ["Protexin", ["protexin"]],
  ["Relaxivet", ["relaxivet"]],
  ["Празител", ["празител"]],
  ["Дирофен", ["дирофен"]],
  ["Милпразон", ["милпразон"]],
  ["Барс", ["барс"]],
  ["Фитоэлита", ["фитоэлита"]],
  ["Пчелодар", ["пчелодар"]],
  ["Cliny", ["cliny"]],
  ["Zolux", ["zolux"]],
  ["PerseiLine", ["perseiline"]],
  ["Зооник", ["зооник"]],
  ["FIORY", ["fiory"]],
  ["Doglike", ["doglike"]],
  ["Зоофортуна", ["зоофортуна", "зф "]],
  ["Лайна", ["лайна"]],
  ["Зверьё", ["зверьё"]],
  ["Wellroom", ["wellroom"]],
  ["Joyser", ["joyser"]],
  ["ZooM", ["zoom"]],
  ["Rio", ["rio"]],
  ["Зоогурман", ["зоогурман"]],
  ["Дилли", ["дилли"]],
  ["Территория", ["территория"]],
];
