import type { BonusProgram } from "@/types/bonus-program";
import type { ActualItem } from "@/types/actual-item";
import type { Brand } from "@/types/brand";
import type { Category } from "@/types/category";
import type { City } from "@/types/city";
import type { FAQ } from "@/types/faq";
import type { Promotion } from "@/types/promotion";
import type { Store } from "@/types/store";
import type { Vacancy } from "@/types/vacancy";

const timestamp = "2026-08-29T00:00:00.000Z";

const brandSeed = [
  ["amper", "Ампер", "/brands/amper-logo.jpg", "#175cd3", "#dbeafe", "Электротовары и решения для электромонтажа."],
  ["ventil", "Вентиль", "/brands/ventil-logo.svg", "#087a66", "#d1fae5", "Товары для водоснабжения, отопления и сантехники."],
  ["metiz-market", "Метиз Маркет", "/brands/metiz-market-logo.jpg", "#b54708", "#ffead5", "Крепёж, инструмент и расходные материалы."],
  ["miska", "Миска", "/brands/miska-logo.jpg", "#c11574", "#fce7f3", "Товары для домашних животных и заботы о них."],
] as const;

const brandDescriptions: Record<string, string> = {
  amper: "«Ампер» — магазин электротоваров и товаров для электромонтажа в Амурске.",
  ventil: "«Вентиль» — магазин сантехники, товаров для водоснабжения и отопления в Амурске.",
  "metiz-market": "«Метиз Маркет» — магазин крепежа, инструмента и расходных материалов в Амурске.",
  miska: "«Миска» — зоомагазин товаров для домашних животных в Амурске.",
};

export const mockBrands: Brand[] = brandSeed.map(
  ([slug, name, logo, primary_color, secondary_color, short_description]) => ({
    id: `brand-${slug}`,
    slug,
    name,
    legal_name: null,
    logo,
    primary_color,
    secondary_color,
    short_description,
    description: brandDescriptions[slug],
    seo_title: `${name} в Амурске — магазины и направления`,
    seo_description: `${short_description} Информация о магазине «${name}» в Амурске.`,
    social_links: [],
    active: true,
    created_at: timestamp,
    updated_at: timestamp,
  }),
);

export const mockCities: City[] = [
  {
    id: "city-amursk",
    slug: "amursk",
    name: "Амурск",
    region: "Хабаровский край",
    country: "Россия",
    latitude: null,
    longitude: null,
    active: true,
    created_at: timestamp,
    updated_at: timestamp,
  },
];

const amurskStoreAddress = "г. Амурск, проспект Победы, 16";
const amurskStoreMapUrl = `https://yandex.ru/maps/?text=${encodeURIComponent(amurskStoreAddress)}`;

const amurskStoreOpeningHours: Store["opening_hours"] = [
  { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], opens: "09:00", closes: "19:00" },
  { days: ["Saturday", "Sunday"], opens: "09:00", closes: "18:00" },
];

const storeTelephoneByBrandSlug: Record<string, string> = {
  amper: "+7 924 316-97-21",
  ventil: "+7 996 388-34-58",
  "metiz-market": "+7 924 316-97-21",
  miska: "+7 999 792-78-81",
};

export const mockStores: Store[] = mockBrands.map((brand) => ({
  id: `store-${brand.slug}-amursk`,
  brand_id: brand.id,
  city_id: "city-amursk",
  name: `${brand.name}, Амурск`,
  slug: `${brand.slug}-amursk`,
  address: amurskStoreAddress,
  postal_code: null,
  latitude: null,
  longitude: null,
  telephone: storeTelephoneByBrandSlug[brand.slug],
  email: null,
  opening_hours: amurskStoreOpeningHours,
  short_description: brand.short_description,
  description: `Физическая торговая точка магазина «${brand.name}» по адресу: ${amurskStoreAddress}.`,
  facade_photo: null,
  entrance_photo: null,
  gallery: [],
  map_links: [{ label: "Яндекс Карты", url: amurskStoreMapUrl }],
  messenger_links: [],
  active: true,
  temporarily_closed: false,
  seo_title: `${brand.name} в Амурске — адрес и контакты магазина`,
  seo_description: `Магазин ${brand.name} в Амурске по адресу ${amurskStoreAddress}: телефон, режим работы и основные направления.`,
  created_at: timestamp,
  updated_at: timestamp,
}));

const categoryNames: Record<string, string[]> = {
  miska: ["Корма", "Лакомства", "Наполнители и туалеты", "Уход", "Витамины и добавки", "Паразитарные средства"],
  amper: ["Электротовары", "Товары для электромонтажа", "Освещение", "Электроинструмент", "Расходные материалы", "Комплектующие"],
  ventil: ["Сантехника", "Водоснабжение", "Отопление", "Смесители", "Канализация", "Комплектующие"],
  "metiz-market": ["Крепёж", "Саморезы", "Болты", "Гайки", "Анкеры", "Дюбели", "Инструмент", "Расходные материалы"],
};

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replaceAll(" ", "-")
    .replaceAll("ё", "e")
    .replace(/[^a-zа-я0-9-]/g, "")
    .normalize("NFD");

export const mockCategories: Category[] = mockBrands.flatMap((brand) =>
  categoryNames[brand.slug].map((name, index) => ({
    id: `category-${brand.slug}-${index + 1}`,
    brand_id: brand.id,
    parent_id: null,
    name,
    slug: slugify(name),
    short_description: "",
    description: "",
    image: null,
    sort_order: index + 1,
    active: true,
    created_at: timestamp,
    updated_at: timestamp,
  })),
);

export const mockPromotions: Promotion[] = [];
export const mockVacancies: Vacancy[] = [];

export const mockActualItems: ActualItem[] = [
  {
    id: "actual-miska-award-vet",
    type: "promotion",
    brandId: "brand-miska",
    title: "AWARD Veterinary Diet",
    shortText: "",
    image: "/actual/miska-award-vet.png",
    imageAlt: "AWARD Veterinary Diet в зоомагазине Миска",
    badge: null,
    buttonText: "Подробнее",
    buttonUrl: "/miska/",
    startsAt: null,
    endsAt: null,
    priority: 400,
    active: true,
  },
  {
    id: "actual-miska-food-treats-gift",
    type: "promotion",
    brandId: "brand-miska",
    title: "Купи корм + 3 лакомства — подарок",
    shortText: "",
    image: "/actual/miska-food-treats-gift.jpg",
    imageAlt: "Акция магазина Миска: корм и три лакомства с подарком",
    imageOrientation: "portrait",
    badge: null,
    buttonText: "Подробнее",
    buttonUrl: "/akcii/",
    startsAt: null,
    endsAt: null,
    priority: 390,
    active: true,
    showOnHome: false,
  },
  {
    id: "actual-bonus-program",
    type: "bonus",
    brandId: null,
    title: "Единая бонусная программа",
    shortText: "",
    image: "/actual/bonus-program.png",
    imageAlt: "Единая бонусная программа магазинов Ампер, Вентиль, Метиз Маркет и Миска",
    badge: null,
    buttonText: "Подробнее",
    buttonUrl: "/bonus/",
    startsAt: null,
    endsAt: null,
    priority: 300,
    active: true,
  },
  {
    id: "actual-amper-vacancy",
    type: "vacancy",
    brandId: "brand-amper",
    title: "Вакансия продавца в магазине Ампер",
    shortText: "",
    image: "/actual/amper-vacancy.png",
    imageAlt: "Вакансия продавца в магазине Ампер",
    badge: null,
    buttonText: "Подробнее",
    buttonUrl: "/vakansii/",
    startsAt: null,
    endsAt: null,
    priority: 200,
    active: true,
  },
  {
    id: "actual-amper-tool-discount-20",
    type: "promotion",
    brandId: "brand-amper",
    title: "Скидка 20% на электроинструмент",
    shortText: "",
    image: "/actual/tool-discount-20.png",
    imageAlt: "Скидка 20% на электроинструмент",
    badge: null,
    buttonText: "Подробнее",
    buttonUrl: "/akcii/",
    startsAt: null,
    endsAt: null,
    priority: 100,
    active: true,
  },
];

export const mockFaqs: FAQ[] = [
  {
    id: "faq-data",
    question: "Где посмотреть адрес и режим работы?",
    answer: "Подтверждённые данные публикуются на странице конкретной торговой точки.",
    brand_id: null,
    city_id: "city-amursk",
    store_id: null,
    category_id: null,
    sort_order: 1,
    active: true,
  },
  {
    id: "faq-catalog",
    question: "Можно ли посмотреть товары и цены на сайте?",
    answer: "Каталог, цены и остатки не входят в первую версию сайта и будут добавлены отдельным этапом.",
    brand_id: null,
    city_id: null,
    store_id: null,
    category_id: null,
    sort_order: 2,
    active: true,
  },
];

export const mockBonusProgram: BonusProgram = {
  id: "bonus-main",
  title: "Бонусная программа",
  short_description: "Покупайте в наших магазинах, получайте бонусы и используйте их при следующих покупках.",
  description: "",
  rules: ["5%", "15%", "3 месяца"],
  participating_brands: [],
  faq: [],
  active: true,
  updated_at: timestamp,
};
