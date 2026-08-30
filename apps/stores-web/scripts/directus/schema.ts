/**
 * Reproducible Directus schema definition and apply script.
 *
 * Run after starting the Compose stack:
 *   DIRECTUS_ADMIN_TOKEN=xxx npm run directus:schema:apply
 *
 * Use DRY_RUN=1 to preview changes without API calls:
 *   DRY_RUN=1 DIRECTUS_ADMIN_TOKEN=xxx npm run directus:schema:apply
 */

import { DirectusAdminClient } from "./api-client";

interface Choice {
  text: string;
  value: string;
}

interface FieldSpec {
  field: string;
  type: string;
  sort?: number;
  meta?: Record<string, unknown>;
  schema?: Record<string, unknown>;
}

interface CollectionSpec {
  collection: string;
  meta?: Record<string, unknown>;
  schema?: Record<string, unknown>;
  fields: FieldSpec[];
}

const baseMeta = {
  accountability: "all",
  archive_app_filter: true,
  archive_field: null,
  archive_value: null,
  collapse: "open",
  group: null,
  hidden: false,
  icon: null,
  item_duplication_fields: null,
  note: null,
  singleton: false,
  sort: null,
  sort_field: null,
  translations: null,
  unarchive_value: null,
  versioning: false,
};

function mergeField(base: FieldSpec, overrides: Partial<FieldSpec>): FieldSpec {
  const sort = overrides.sort ?? base.sort;
  return {
    ...base,
    ...overrides,
    meta: {
      ...base.meta,
      ...(overrides.meta ?? {}),
      ...(sort !== undefined ? { sort } : {}),
    },
    schema: overrides.schema === undefined ? base.schema : overrides.schema,
  };
}

function stringField(field: string, overrides: Partial<FieldSpec> = {}): FieldSpec {
  return mergeField(
    {
      field,
      type: "string",
      meta: { interface: "input", special: null, width: "full" },
      schema: { data_type: "varchar", length: 255, nullable: true },
    },
    overrides,
  );
}

function textField(field: string, overrides: Partial<FieldSpec> = {}): FieldSpec {
  return mergeField(
    {
      field,
      type: "text",
      meta: { interface: "input-multiline", special: null, width: "full" },
      schema: { data_type: "text", nullable: true },
    },
    overrides,
  );
}

function integerField(field: string, overrides: Partial<FieldSpec> = {}): FieldSpec {
  return mergeField(
    {
      field,
      type: "integer",
      meta: { interface: "input", special: null, width: "full" },
      schema: { data_type: "integer", nullable: true },
    },
    overrides,
  );
}

function booleanField(field: string, overrides: Partial<FieldSpec> = {}): FieldSpec {
  return mergeField(
    {
      field,
      type: "boolean",
      meta: { interface: "boolean", special: null, width: "full" },
      schema: { data_type: "boolean", nullable: true, default: true },
    },
    overrides,
  );
}

function dropdownField(field: string, choices: Choice[], overrides: Partial<FieldSpec> = {}): FieldSpec {
  return mergeField(
    {
      field,
      type: "string",
      meta: {
        interface: "select-dropdown",
        special: null,
        width: "full",
        options: { choices: choices.map((c) => ({ text: c.text, value: c.value })) },
      },
      schema: { data_type: "varchar", length: 32, nullable: false },
    },
    overrides,
  );
}

function colorField(field: string, overrides: Partial<FieldSpec> = {}): FieldSpec {
  return mergeField(
    {
      field,
      type: "string",
      meta: { interface: "select-color", special: null, width: "full" },
      schema: { data_type: "varchar", length: 7, nullable: false },
    },
    overrides,
  );
}

function jsonField(field: string, overrides: Partial<FieldSpec> = {}): FieldSpec {
  return mergeField(
    {
      field,
      type: "json",
      meta: { interface: "input-code", special: null, width: "full" },
      schema: { data_type: "json", nullable: true },
    },
    overrides,
  );
}

function timestampField(field: string, overrides: Partial<FieldSpec> = {}): FieldSpec {
  return mergeField(
    {
      field,
      type: "timestamp",
      meta: { interface: "datetime", special: null, width: "full" },
      schema: { data_type: "timestamp", nullable: true },
    },
    overrides,
  );
}

function m2oField(
  field: string,
  relatedCollection: string,
  displayTemplate: string,
  overrides: Partial<FieldSpec> = {},
): FieldSpec {
  return mergeField(
    {
      field,
      type: "uuid",
      meta: {
        interface: "select-dropdown-m2o",
        special: ["m2o"],
        width: "full",
        related_collection: relatedCollection,
        display: "related-values",
        display_options: { template: displayTemplate },
      },
      schema: { data_type: "uuid", nullable: true },
    },
    overrides,
  );
}

function fileField(field: string, overrides: Partial<FieldSpec> = {}): FieldSpec {
  return mergeField(
    {
      field,
      type: "uuid",
      meta: {
        interface: "file-image",
        special: ["file"],
        width: "full",
        related_collection: "directus_files",
        display: "image",
        display_options: { project_logo: false },
      },
      schema: { data_type: "uuid", nullable: true },
    },
    overrides,
  );
}

const ru = (translation: string) => [{ language: "ru-RU", translation }];

const hiddenSystem = { hidden: true };
const seoGroup = { group: "seo_social" };

export const schema: CollectionSpec[] = [
  {
    collection: "brands",
    meta: {
      ...baseMeta,
      icon: "store",
      display_template: "{{name}}",
      translations: ru("Магазины"),
    },
    fields: [
      stringField("name", {
        sort: 1,
        meta: { translations: ru("Название"), required: true },
        schema: { data_type: "varchar", length: 255, nullable: false },
      }),
      stringField("slug", {
        sort: 2,
        meta: {
          translations: ru("Slug"),
          note: "Используется в URL. Обычно менять не нужно после запуска.",
          required: true,
        },
        schema: { data_type: "varchar", length: 255, nullable: false, is_unique: true },
      }),
      stringField("legal_name", {
        sort: 3,
        meta: { translations: ru("Юридическое название") },
      }),
      fileField("logo", {
        sort: 4,
        meta: { translations: ru("Логотип") },
      }),
      colorField("primary_color", {
        sort: 5,
        meta: { translations: ru("Основной цвет"), required: true },
      }),
      colorField("secondary_color", {
        sort: 6,
        meta: { translations: ru("Дополнительный цвет"), required: true },
      }),
      textField("short_description", {
        sort: 7,
        meta: { translations: ru("Краткое описание") },
      }),
      textField("description", {
        sort: 8,
        meta: { translations: ru("Описание") },
      }),
      booleanField("active", {
        sort: 9,
        meta: { translations: ru("Активно"), required: true },
        schema: { data_type: "boolean", nullable: false, default: true },
      }),
      stringField("seo_title", {
        sort: 10,
        meta: { translations: ru("SEO заголовок"), ...seoGroup },
      }),
      textField("seo_description", {
        sort: 11,
        meta: { translations: ru("SEO описание"), ...seoGroup },
      }),
      jsonField("social_links", {
        sort: 12,
        meta: { translations: ru("Ссылки на соцсети"), ...seoGroup },
      }),
      timestampField("created_at", { sort: 13, meta: hiddenSystem }),
      timestampField("updated_at", { sort: 14, meta: hiddenSystem }),
    ],
  },
  {
    collection: "cities",
    meta: {
      ...baseMeta,
      icon: "location_city",
      display_template: "{{name}}",
      translations: ru("Города"),
    },
    fields: [
      stringField("name", {
        sort: 1,
        meta: { translations: ru("Город"), required: true },
        schema: { data_type: "varchar", length: 255, nullable: false },
      }),
      stringField("slug", {
        sort: 2,
        meta: {
          translations: ru("Slug"),
          note: "Используется в URL. Обычно менять не нужно после запуска.",
          required: true,
        },
        schema: { data_type: "varchar", length: 255, nullable: false, is_unique: true },
      }),
      stringField("region", {
        sort: 3,
        meta: { translations: ru("Регион") },
      }),
      stringField("country", {
        sort: 4,
        meta: { translations: ru("Страна") },
      }),
      stringField("latitude", {
        sort: 5,
        meta: { translations: ru("Широта") },
        schema: { data_type: "varchar", length: 32, nullable: true },
      }),
      stringField("longitude", {
        sort: 6,
        meta: { translations: ru("Долгота") },
        schema: { data_type: "varchar", length: 32, nullable: true },
      }),
      booleanField("active", {
        sort: 7,
        meta: { translations: ru("Активно"), required: true },
        schema: { data_type: "boolean", nullable: false, default: true },
      }),
      timestampField("created_at", { sort: 8, meta: hiddenSystem }),
      timestampField("updated_at", { sort: 9, meta: hiddenSystem }),
    ],
  },
  {
    collection: "stores",
    meta: {
      ...baseMeta,
      icon: "place",
      display_template: "{{name}}",
      translations: ru("Торговые точки"),
    },
    fields: [
      stringField("name", {
        sort: 1,
        meta: { translations: ru("Название точки"), required: true },
        schema: { data_type: "varchar", length: 255, nullable: false },
      }),
      m2oField("brand_id", "brands", "{{name}}", {
        sort: 2,
        meta: { translations: ru("Магазин"), required: true },
        schema: { data_type: "uuid", nullable: false },
      }),
      m2oField("city_id", "cities", "{{name}}", {
        sort: 3,
        meta: { translations: ru("Город"), required: true },
        schema: { data_type: "uuid", nullable: false },
      }),
      stringField("slug", {
        sort: 4,
        meta: {
          translations: ru("Slug"),
          note: "Используется в URL. Обычно менять не нужно после запуска.",
          required: true,
        },
        schema: { data_type: "varchar", length: 255, nullable: false },
      }),
      textField("address", {
        sort: 5,
        meta: { translations: ru("Адрес") },
      }),
      stringField("postal_code", {
        sort: 6,
        meta: { translations: ru("Почтовый индекс") },
      }),
      stringField("telephone", {
        sort: 7,
        meta: { translations: ru("Телефон") },
      }),
      stringField("email", {
        sort: 8,
        meta: { translations: ru("Email") },
      }),
      jsonField("opening_hours", {
        sort: 9,
        meta: { translations: ru("Часы работы") },
      }),
      textField("short_description", {
        sort: 10,
        meta: { translations: ru("Краткое описание") },
      }),
      textField("description", {
        sort: 11,
        meta: { translations: ru("Описание") },
      }),
      fileField("facade_photo", {
        sort: 12,
        meta: { translations: ru("Фото фасада") },
      }),
      fileField("entrance_photo", {
        sort: 13,
        meta: { translations: ru("Фото входа") },
      }),
      jsonField("gallery", {
        sort: 14,
        meta: { translations: ru("Галерея") },
      }),
      jsonField("map_links", {
        sort: 15,
        meta: { translations: ru("Ссылки на карту") },
      }),
      jsonField("messenger_links", {
        sort: 16,
        meta: { translations: ru("Мессенджеры") },
      }),
      stringField("latitude", {
        sort: 17,
        meta: { translations: ru("Широта") },
        schema: { data_type: "varchar", length: 32, nullable: true },
      }),
      stringField("longitude", {
        sort: 18,
        meta: { translations: ru("Долгота") },
        schema: { data_type: "varchar", length: 32, nullable: true },
      }),
      booleanField("temporarily_closed", {
        sort: 19,
        meta: { translations: ru("Временно закрыто") },
        schema: { data_type: "boolean", nullable: false, default: false },
      }),
      booleanField("active", {
        sort: 20,
        meta: { translations: ru("Активно"), required: true },
        schema: { data_type: "boolean", nullable: false, default: true },
      }),
      stringField("seo_title", {
        sort: 21,
        meta: { translations: ru("SEO заголовок"), ...seoGroup },
      }),
      textField("seo_description", {
        sort: 22,
        meta: { translations: ru("SEO описание"), ...seoGroup },
      }),
      timestampField("created_at", { sort: 23, meta: hiddenSystem }),
      timestampField("updated_at", { sort: 24, meta: hiddenSystem }),
    ],
  },
  {
    collection: "categories",
    meta: {
      ...baseMeta,
      icon: "category",
      display_template: "{{name}}",
      translations: ru("Категории"),
    },
    fields: [
      stringField("name", {
        sort: 1,
        meta: { translations: ru("Название"), required: true },
        schema: { data_type: "varchar", length: 255, nullable: false },
      }),
      stringField("slug", {
        sort: 2,
        meta: {
          translations: ru("Slug"),
          note: "Используется в URL. Обычно менять не нужно после запуска.",
          required: true,
        },
        schema: { data_type: "varchar", length: 255, nullable: false },
      }),
      m2oField("brand_id", "brands", "{{name}}", {
        sort: 3,
        meta: { translations: ru("Магазин") },
      }),
      m2oField("parent_id", "categories", "{{name}}", {
        sort: 4,
        meta: { translations: ru("Родительская категория") },
      }),
      textField("short_description", {
        sort: 5,
        meta: { translations: ru("Краткое описание") },
      }),
      textField("description", {
        sort: 6,
        meta: { translations: ru("Описание") },
      }),
      fileField("image", {
        sort: 7,
        meta: { translations: ru("Изображение") },
      }),
      integerField("sort_order", {
        sort: 8,
        meta: { translations: ru("Порядок"), required: true },
        schema: { data_type: "integer", nullable: false, default: 0 },
      }),
      booleanField("active", {
        sort: 9,
        meta: { translations: ru("Активно"), required: true },
        schema: { data_type: "boolean", nullable: false, default: true },
      }),
      timestampField("created_at", { sort: 10, meta: hiddenSystem }),
      timestampField("updated_at", { sort: 11, meta: hiddenSystem }),
    ],
  },
  {
    collection: "promotions",
    meta: {
      ...baseMeta,
      icon: "local_offer",
      display_template: "{{title}}",
      translations: ru("Акции"),
    },
    fields: [
      stringField("title", {
        sort: 1,
        meta: { translations: ru("Заголовок"), required: true },
        schema: { data_type: "varchar", length: 255, nullable: false },
      }),
      stringField("slug", {
        sort: 2,
        meta: {
          translations: ru("Slug"),
          note: "Используется в URL. Обычно менять не нужно после запуска.",
          required: true,
        },
        schema: { data_type: "varchar", length: 255, nullable: false, is_unique: true },
      }),
      m2oField("brand_id", "brands", "{{name}}", {
        sort: 3,
        meta: { translations: ru("Магазин") },
      }),
      m2oField("city_id", "cities", "{{name}}", {
        sort: 4,
        meta: { translations: ru("Город") },
      }),
      jsonField("store_ids", {
        sort: 5,
        meta: {
          translations: ru("Торговые точки"),
          note: "Массив идентификаторов торговых точек (UUID), участвующих в акции.",
        },
      }),
      fileField("image", {
        sort: 6,
        meta: { translations: ru("Изображение") },
      }),
      textField("short_description", {
        sort: 7,
        meta: { translations: ru("Краткое описание") },
      }),
      textField("description", {
        sort: 8,
        meta: { translations: ru("Описание") },
      }),
      textField("terms", {
        sort: 9,
        meta: { translations: ru("Условия") },
      }),
      timestampField("start_date", {
        sort: 10,
        meta: { translations: ru("Начало") },
      }),
      timestampField("end_date", {
        sort: 11,
        meta: { translations: ru("Окончание") },
      }),
      booleanField("active", {
        sort: 12,
        meta: { translations: ru("Активно"), required: true },
        schema: { data_type: "boolean", nullable: false, default: true },
      }),
      stringField("seo_title", {
        sort: 13,
        meta: { translations: ru("SEO заголовок"), ...seoGroup },
      }),
      textField("seo_description", {
        sort: 14,
        meta: { translations: ru("SEO описание"), ...seoGroup },
      }),
      timestampField("created_at", { sort: 15, meta: hiddenSystem }),
      timestampField("updated_at", { sort: 16, meta: hiddenSystem }),
    ],
  },
  {
    collection: "bonus_programs",
    meta: {
      ...baseMeta,
      icon: "card_giftcard",
      singleton: true,
      translations: ru("Бонусная программа"),
    },
    fields: [
      stringField("title", {
        sort: 1,
        meta: { translations: ru("Заголовок"), required: true },
        schema: { data_type: "varchar", length: 255, nullable: false },
      }),
      textField("short_description", {
        sort: 2,
        meta: { translations: ru("Краткое описание") },
      }),
      textField("description", {
        sort: 3,
        meta: { translations: ru("Описание / Условия") },
      }),
      jsonField("rules", {
        sort: 4,
        meta: { translations: ru("Правила программы") },
      }),
      jsonField("participating_brands", {
        sort: 5,
        meta: { translations: ru("Участвующие магазины") },
      }),
      jsonField("faq", {
        sort: 6,
        meta: { translations: ru("FAQ") },
      }),
      booleanField("active", {
        sort: 7,
        meta: { translations: ru("Активно"), required: true },
        schema: { data_type: "boolean", nullable: false, default: true },
      }),
      timestampField("updated_at", { sort: 8, meta: hiddenSystem }),
    ],
  },
  {
    collection: "faqs",
    meta: {
      ...baseMeta,
      icon: "help",
      display_template: "{{question}}",
      translations: ru("Вопросы и ответы"),
    },
    fields: [
      textField("question", {
        sort: 1,
        meta: { translations: ru("Вопрос"), required: true },
        schema: { data_type: "text", nullable: false },
      }),
      textField("answer", {
        sort: 2,
        meta: { translations: ru("Ответ") },
      }),
      m2oField("brand_id", "brands", "{{name}}", {
        sort: 3,
        meta: { translations: ru("Магазин") },
      }),
      m2oField("city_id", "cities", "{{name}}", {
        sort: 4,
        meta: { translations: ru("Город") },
      }),
      m2oField("store_id", "stores", "{{name}}", {
        sort: 5,
        meta: { translations: ru("Торговая точка") },
      }),
      m2oField("category_id", "categories", "{{name}}", {
        sort: 6,
        meta: { translations: ru("Категория") },
      }),
      integerField("sort_order", {
        sort: 7,
        meta: { translations: ru("Порядок"), required: true },
        schema: { data_type: "integer", nullable: false, default: 0 },
      }),
      booleanField("active", {
        sort: 8,
        meta: { translations: ru("Активно"), required: true },
        schema: { data_type: "boolean", nullable: false, default: true },
      }),
    ],
  },
  {
    collection: "vacancies",
    meta: {
      ...baseMeta,
      icon: "work",
      display_template: "{{title}}",
      translations: ru("Вакансии"),
    },
    fields: [
      stringField("title", {
        sort: 1,
        meta: { translations: ru("Вакансия"), required: true },
        schema: { data_type: "varchar", length: 255, nullable: false },
      }),
      m2oField("brand_id", "brands", "{{name}}", {
        sort: 2,
        meta: { translations: ru("Магазин") },
      }),
      m2oField("store_id", "stores", "{{name}}", {
        sort: 3,
        meta: { translations: ru("Торговая точка") },
      }),
      integerField("salary_from", {
        sort: 4,
        meta: { translations: ru("Зарплата от") },
      }),
      integerField("salary_to", {
        sort: 5,
        meta: { translations: ru("Зарплата до") },
      }),
      stringField("schedule", {
        sort: 6,
        meta: { translations: ru("График работы") },
      }),
      stringField("employment_type", {
        sort: 7,
        meta: { translations: ru("Тип занятости") },
      }),
      textField("description", {
        sort: 8,
        meta: { translations: ru("Описание") },
      }),
      textField("requirements", {
        sort: 9,
        meta: { translations: ru("Требования") },
      }),
      stringField("contact", {
        sort: 10,
        meta: { translations: ru("Контакты") },
      }),
      booleanField("active", {
        sort: 11,
        meta: { translations: ru("Активно"), required: true },
        schema: { data_type: "boolean", nullable: false, default: true },
      }),
      timestampField("published_at", {
        sort: 12,
        meta: { translations: ru("Дата публикации") },
      }),
      timestampField("created_at", { sort: 13, meta: hiddenSystem }),
      timestampField("updated_at", { sort: 14, meta: hiddenSystem }),
    ],
  },
  {
    collection: "actual_items",
    meta: {
      ...baseMeta,
      icon: "campaign",
      display_template: "{{title}}",
      translations: ru("Актуальное"),
      sort_field: "priority",
    },
    fields: [
      dropdownField(
        "type",
        [
          { value: "promotion", text: "Акция" },
          { value: "vacancy", text: "Вакансия" },
          { value: "bonus", text: "Бонусная программа" },
          { value: "announcement", text: "Объявление" },
        ],
        {
          sort: 2,
          meta: {
            translations: ru("Тип материала"),
            required: true,
          },
        },
      ),
      m2oField("brandId", "brands", "{{name}}", {
        sort: 3,
        meta: {
          translations: ru("Магазин"),
          note: "Выберите магазин, к которому относится материал. Для общих материалов оставьте пустым.",
          required: false,
        },
        schema: { data_type: "uuid", nullable: true },
      }),
      stringField("title", {
        sort: 4,
        meta: { translations: ru("Заголовок"), required: true },
        schema: { data_type: "varchar", length: 255, nullable: false },
      }),
      textField("shortText", {
        sort: 5,
        meta: {
          translations: ru("Краткий текст"),
          note: "Краткое описание под заголовком. Можно оставить пустым.",
        },
      }),
      fileField("image", {
        sort: 6,
        meta: {
          translations: ru("Баннер / изображение"),
          required: true,
        },
        schema: { data_type: "uuid", nullable: false },
      }),
      stringField("imageAlt", {
        sort: 7,
        meta: {
          translations: ru("Описание изображения"),
          note: "Текст для accessibility и поисковых систем.",
        },
      }),
      dropdownField(
        "imageOrientation",
        [
          { value: "landscape", text: "Горизонтальный" },
          { value: "portrait", text: "Вертикальный" },
          { value: "square", text: "Квадратный" },
        ],
        {
          sort: 8,
          meta: {
            translations: ru("Формат изображения"),
          },
          schema: { data_type: "varchar", length: 16, nullable: true, default: "landscape" },
        },
      ),
      stringField("badge", {
        sort: 9,
        meta: {
          translations: ru("Метка"),
          note: "Например: -20%, Новинка, Акция.",
        },
      }),
      stringField("buttonUrl", {
        sort: 10,
        meta: {
          translations: ru("Ссылка"),
          note: "Внутренняя ссылка вида /akcii/ или полный URL.",
        },
      }),
      stringField("buttonText", {
        sort: 11,
        meta: { translations: ru("Текст кнопки") },
        schema: { data_type: "varchar", length: 255, nullable: true, default: "Подробнее" },
      }),
      timestampField("startsAt", {
        sort: 12,
        meta: { translations: ru("Начало показа") },
      }),
      timestampField("endsAt", {
        sort: 13,
        meta: { translations: ru("Окончание показа") },
      }),
      booleanField("showOnHome", {
        sort: 14,
        meta: {
          translations: ru("Показывать на главной"),
          note: "Если выключено, материал показывается только на странице магазина.",
          required: true,
        },
        schema: { data_type: "boolean", nullable: false, default: true },
      }),
      integerField("priority", {
        sort: 15,
        meta: {
          translations: ru("Приоритет"),
          note: "Чем больше значение, тем выше материал показывается.",
          required: true,
        },
        schema: { data_type: "integer", nullable: false, default: 0 },
      }),
      booleanField("active", {
        sort: 16,
        meta: { translations: ru("Активно"), required: true },
        schema: { data_type: "boolean", nullable: false, default: true },
      }),
    ],
  },
];

const primaryKeyField: FieldSpec = {
  field: "id",
  type: "uuid",
  meta: { hidden: true, interface: "input", special: null, width: "full" },
  schema: { is_primary_key: true, has_auto_increment: false, nullable: false },
};

async function updateProjectSettings(client: DirectusAdminClient) {
  console.log("Ensuring project default language is ru-RU");
  if (!client.dryRun) {
    await client.patch("/settings", { default_language: "ru-RU" });
  }
}

async function collectionExists(client: DirectusAdminClient, collection: string): Promise<boolean> {
  try {
    await client.get<{ data: unknown }>(`/collections/${collection}`);
    return true;
  } catch {
    return false;
  }
}

async function fieldExists(client: DirectusAdminClient, collection: string, field: string): Promise<boolean> {
  try {
    await client.get<{ data: unknown }>(`/fields/${collection}/${field}`);
    return true;
  } catch {
    return false;
  }
}

function normalizeSchema(schema?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!schema) return undefined;
  const normalized = { ...schema };
  if ("nullable" in normalized) {
    normalized.is_nullable = normalized.nullable;
    delete normalized.nullable;
  }
  return normalized;
}

async function ensureCollection(client: DirectusAdminClient, spec: CollectionSpec) {
  console.log(`Ensuring collection: ${spec.collection}`);
  const exists = await collectionExists(client, spec.collection);
  const meta = { ...baseMeta, ...spec.meta };

  if (exists) {
    console.log(`  Collection ${spec.collection} already exists, updating meta.`);
    if (!client.dryRun) {
      await client.patch(`/collections/${spec.collection}`, { meta });
    }
  } else {
    await client.post("/collections", {
      collection: spec.collection,
      meta,
      schema: { name: spec.collection, ...(spec.schema ?? {}) },
      fields: [primaryKeyField],
    });
  }

  for (const field of spec.fields) {
    console.log(`  Ensuring field: ${field.field}`);
    const fieldAlreadyExists = await fieldExists(client, spec.collection, field.field);
    const schema = normalizeSchema(field.schema);

    if (fieldAlreadyExists) {
      console.log(`    Field ${field.field} already exists, updating meta/schema.`);
      if (!client.dryRun) {
        await client.patch(`/fields/${spec.collection}/${field.field}`, {
          meta: field.meta,
          schema,
        });
      }
    } else {
      await client.post(`/fields/${spec.collection}`, {
        collection: spec.collection,
        field: field.field,
        type: field.type,
        meta: field.meta,
        schema,
      });
    }
  }

  for (const field of spec.fields) {
    const meta = field.meta ?? {};
    const special = (meta.special ?? []) as string[];
    const relatedCollection = meta.related_collection as string | undefined;
    if (!relatedCollection || special.length === 0) continue;

    const isRelation = special.includes("m2o") || special.includes("file");
    if (!isRelation) continue;

    console.log(`  Ensuring relation: ${spec.collection}.${field.field} -> ${relatedCollection}`);
    try {
      await client.post("/relations", {
        collection: spec.collection,
        field: field.field,
        related_collection: relatedCollection,
        meta: { one_field: null, sort_field: null, junction_field: null },
        schema: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("already exists") ||
        message.includes("Duplicate") ||
        message.includes("already has an associated relationship")
      ) {
        console.log(`    Relation already exists, skipping.`);
      } else {
        throw error;
      }
    }
  }
}

async function main() {
  const directusUrl = process.env.DIRECTUS_URL;
  const token = process.env.DIRECTUS_ADMIN_TOKEN;
  const dryRun = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";

  if (!directusUrl) {
    console.error("DIRECTUS_URL is required");
    process.exit(1);
  }
  if (!token) {
    console.error("DIRECTUS_ADMIN_TOKEN is required for schema operations");
    process.exit(1);
  }

  const client = new DirectusAdminClient({ directusUrl, token, dryRun });

  console.log(`Applying schema to ${directusUrl}${dryRun ? " (dry run)" : ""}`);

  await updateProjectSettings(client);

  for (const spec of schema) {
    await ensureCollection(client, spec);
  }

  console.log("Schema apply complete.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
