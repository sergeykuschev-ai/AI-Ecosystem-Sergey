export interface IndexablePageSeo {
  path: string;
  title: string;
  description: string;
  h1: string;
  intent: string;
}

/**
 * SEO contract for indexable, content-independent routes.
 *
 * Dynamic city and store routes are covered by builders below. Keeping the
 * primary intent beside the visible metadata makes overlap a reviewable product
 * decision instead of an undocumented side effect of page copy.
 */
export const INDEXABLE_STATIC_PAGE_SEO = [
  {
    path: "/",
    title: "Магазины Ампер, Вентиль, Метиз Маркет и Миска в Амурске",
    description: "Официальный сайт четырёх магазинов в Амурске: выберите «Ампер», «Вентиль», «Метиз Маркет» или «Миску», узнайте направления и перейдите к нужной торговой точке.",
    h1: "Четыре магазина. Всё для дома, ремонта и питомцев.",
    intent: "Навигация по четырём брендам и разделам сайта",
  },
  {
    path: "/amper/",
    title: "Ампер — магазин электротоваров в Амурске | Проспект Победы, 16",
    description: "Магазин электротоваров «Ампер» в Амурске: товары для электромонтажа, освещение, электроинструмент и расходные материалы. Адрес: проспект Победы, 16.",
    h1: "Электротовары для дома и ремонта в Амурске",
    intent: "Ассортимент и услуги магазина электротоваров «Ампер»",
  },
  {
    path: "/ventil/",
    title: "Вентиль — магазин сантехники в Амурске | Проспект Победы, 16",
    description: "Магазин сантехники «Вентиль» в Амурске: сантехника, водоснабжение, отопление, арматура, смесители, канализация и расходные материалы. Проспект Победы, 16.",
    h1: "Сантехника, водоснабжение и отопление в Амурске",
    intent: "Ассортимент и услуги магазина сантехники «Вентиль»",
  },
  {
    path: "/metiz-market/",
    title: "Метиз Маркет — крепёж, метизы и инструмент в Амурске",
    description: "Магазин «Метиз Маркет» в Амурске: крепёж, метизы, ручной и электроинструмент, расходные материалы для ремонта и монтажа. Адрес: проспект Победы, 16.",
    h1: "Крепёж, метизы и инструмент в Амурске",
    intent: "Ассортимент и услуги магазина крепежа «Метиз Маркет»",
  },
  {
    path: "/miska/",
    title: "Миска — зоомагазин в Амурске | Корма и товары для кошек и собак",
    description: "Зоомагазин «Миска» в Амурске на проспекте Победы, 16: корма для собак и кошек, лакомства, наполнители, товары для ухода, игрушки, амуниция, витамины и добавки.",
    h1: "Зоотовары для собак и кошек в Амурске",
    intent: "Ассортимент и услуги зоомагазина «Миска»",
  },
  {
    path: "/stores/",
    title: "Магазины по городам",
    description: "Физические торговые точки магазинов «Ампер», «Вентиль», «Метиз Маркет» и «Миска» по городам.",
    h1: "Магазины",
    intent: "Выбор города со списком физических торговых точек",
  },
  {
    path: "/akcii/",
    title: "Акции магазинов в Амурске",
    description: "Подтверждённые акции магазинов «Ампер», «Вентиль», «Метиз Маркет» и «Миска» в Амурске.",
    h1: "Акции",
    intent: "Действующие акции и их условия",
  },
  {
    path: "/bonus/",
    title: "Бонусная программа магазинов в Амурске",
    description: "Условия бонусной программы участвующих магазинов в Амурске: начисление, использование и срок действия бонусов.",
    h1: "Бонусная программа",
    intent: "Правила начисления и использования бонусов",
  },
  {
    path: "/vakansii/",
    title: "Вакансии магазинов в Амурске",
    description: "Актуальные вакансии магазинов «Ампер», «Вентиль», «Метиз Маркет» и «Миска» в Амурске.",
    h1: "Вакансии",
    intent: "Актуальные вакансии и условия найма",
  },
  {
    path: "/o-kompanii/",
    title: "О компании | Магазины Ампер, Вентиль, Метиз Маркет и Миска в Амурске",
    description: "Четыре магазина в центре Амурска по адресу проспект Победы, 16: электротовары, сантехника, крепёж и товары для питомцев.",
    h1: "Четыре магазина в центре Амурска",
    intent: "Информация о компании и её магазинах",
  },
  {
    path: "/kontakty/",
    title: "Телефоны магазинов в Амурске | Ампер, Вентиль, Метиз Маркет, Миска",
    description: "Телефоны и способы связи с магазинами «Ампер», «Вентиль», «Метиз Маркет» и «Миска» в Амурске. Выберите магазин, чтобы позвонить или открыть карту.",
    h1: "Контакты магазинов в Амурске",
    intent: "Телефоны и способы связи с магазинами",
  },
  {
    path: "/faq/",
    title: "Ответы на частые вопросы о магазинах и бонусах",
    description: "Ответы на частые вопросы об адресах магазинов, режиме работы, товарах, ценах и бонусной программе.",
    h1: "Частые вопросы",
    intent: "Ответы на вопросы покупателей о магазинах и бонусах",
  },
] as const satisfies readonly IndexablePageSeo[];

export type StaticSeoPath = (typeof INDEXABLE_STATIC_PAGE_SEO)[number]["path"];

export function getStaticPageSeo(path: StaticSeoPath): IndexablePageSeo {
  const page = INDEXABLE_STATIC_PAGE_SEO.find((item) => item.path === path);
  if (!page) throw new Error(`Missing SEO contract for ${path}`);
  return page;
}

export function createCityPageSeo(city: { slug: string; name: string; region: string }): IndexablePageSeo {
  return {
    path: `/stores/${city.slug}/`,
    title: `Торговые точки в ${city.name} — адреса и режим работы`,
    description: `Выберите физическую торговую точку в городе ${city.name}, ${city.region}: адрес, режим работы и переход на страницу нужного магазина.`,
    h1: `Магазины в ${city.name}`,
    intent: `Выбор физической торговой точки в городе ${city.name}`,
  };
}

export function createStorePageSeo(store: {
  slug: string;
  name: string;
  seo_title: string;
  seo_description: string;
}, city: { slug: string; name: string }): IndexablePageSeo {
  return {
    path: `/stores/${city.slug}/${store.slug}/`,
    title: store.seo_title,
    description: store.seo_description,
    h1: store.name,
    intent: `Адрес, телефон и режим работы торговой точки «${store.name}» в городе ${city.name}`,
  };
}
