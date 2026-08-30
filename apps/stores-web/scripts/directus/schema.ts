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

interface FieldSpec {
  field: string;
  type: string;
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
  return {
    ...base,
    ...overrides,
    meta: { ...base.meta, ...(overrides.meta ?? {}) },
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

function m2oField(field: string, relatedCollection: string, overrides: Partial<FieldSpec> = {}): FieldSpec {
  return mergeField(
    {
      field,
      type: "uuid",
      meta: { interface: "select-dropdown-m2o", special: ["m2o"], width: "full", related_collection: relatedCollection },
      schema: undefined,
    },
    overrides,
  );
}

function fileField(field: string, overrides: Partial<FieldSpec> = {}): FieldSpec {
  return mergeField(
    {
      field,
      type: "uuid",
      meta: { interface: "file-image", special: ["file"], width: "full", related_collection: "directus_files" },
      schema: undefined,
    },
    overrides,
  );
}

export const schema: CollectionSpec[] = [
  {
    collection: "brands",
    meta: { ...baseMeta, icon: "store" },
    fields: [
      stringField("slug", { schema: { data_type: "varchar", length: 255, nullable: false, is_unique: true } }),
      stringField("name", { schema: { data_type: "varchar", length: 255, nullable: false } }),
      stringField("legal_name"),
      fileField("logo"),
      stringField("primary_color", { schema: { data_type: "varchar", length: 7, nullable: false } }),
      stringField("secondary_color", { schema: { data_type: "varchar", length: 7, nullable: false } }),
      textField("short_description"),
      textField("description"),
      stringField("seo_title"),
      textField("seo_description"),
      jsonField("social_links"),
      booleanField("active", { schema: { data_type: "boolean", nullable: false, default: true } }),
      timestampField("created_at"),
      timestampField("updated_at"),
    ],
  },
  {
    collection: "cities",
    meta: { ...baseMeta, icon: "location_city" },
    fields: [
      stringField("slug", { schema: { data_type: "varchar", length: 255, nullable: false, is_unique: true } }),
      stringField("name", { schema: { data_type: "varchar", length: 255, nullable: false } }),
      stringField("region"),
      stringField("country"),
      stringField("latitude", { schema: { data_type: "varchar", length: 32, nullable: true } }),
      stringField("longitude", { schema: { data_type: "varchar", length: 32, nullable: true } }),
      booleanField("active", { schema: { data_type: "boolean", nullable: false, default: true } }),
      timestampField("created_at"),
      timestampField("updated_at"),
    ],
  },
  {
    collection: "stores",
    meta: { ...baseMeta, icon: "place" },
    fields: [
      m2oField("brand_id", "brands"),
      m2oField("city_id", "cities"),
      stringField("name", { schema: { data_type: "varchar", length: 255, nullable: false } }),
      stringField("slug", { schema: { data_type: "varchar", length: 255, nullable: false } }),
      textField("address"),
      stringField("postal_code"),
      stringField("latitude", { schema: { data_type: "varchar", length: 32, nullable: true } }),
      stringField("longitude", { schema: { data_type: "varchar", length: 32, nullable: true } }),
      stringField("telephone"),
      stringField("email"),
      jsonField("opening_hours"),
      textField("short_description"),
      textField("description"),
      fileField("facade_photo"),
      fileField("entrance_photo"),
      jsonField("gallery"),
      jsonField("map_links"),
      jsonField("messenger_links"),
      booleanField("active", { schema: { data_type: "boolean", nullable: false, default: true } }),
      booleanField("temporarily_closed", { schema: { data_type: "boolean", nullable: false, default: false } }),
      stringField("seo_title"),
      textField("seo_description"),
      timestampField("created_at"),
      timestampField("updated_at"),
    ],
  },
  {
    collection: "categories",
    meta: { ...baseMeta, icon: "category" },
    fields: [
      m2oField("brand_id", "brands"),
      m2oField("parent_id", "categories"),
      stringField("name", { schema: { data_type: "varchar", length: 255, nullable: false } }),
      stringField("slug", { schema: { data_type: "varchar", length: 255, nullable: false } }),
      textField("short_description"),
      textField("description"),
      fileField("image"),
      integerField("sort_order", { schema: { data_type: "integer", nullable: false, default: 0 } }),
      booleanField("active", { schema: { data_type: "boolean", nullable: false, default: true } }),
      timestampField("created_at"),
      timestampField("updated_at"),
    ],
  },
  {
    collection: "promotions",
    meta: { ...baseMeta, icon: "local_offer" },
    fields: [
      stringField("title", { schema: { data_type: "varchar", length: 255, nullable: false } }),
      stringField("slug", { schema: { data_type: "varchar", length: 255, nullable: false, is_unique: true } }),
      m2oField("brand_id", "brands"),
      m2oField("city_id", "cities"),
      jsonField("store_ids"),
      timestampField("start_date"),
      timestampField("end_date"),
      textField("short_description"),
      textField("description"),
      fileField("image"),
      textField("terms"),
      booleanField("active", { schema: { data_type: "boolean", nullable: false, default: true } }),
      stringField("seo_title"),
      textField("seo_description"),
      timestampField("created_at"),
      timestampField("updated_at"),
    ],
  },
  {
    collection: "bonus_programs",
    meta: { ...baseMeta, icon: "card_giftcard", singleton: true },
    fields: [
      stringField("title", { schema: { data_type: "varchar", length: 255, nullable: false } }),
      textField("short_description"),
      textField("description"),
      jsonField("rules"),
      jsonField("participating_brands"),
      jsonField("faq"),
      booleanField("active", { schema: { data_type: "boolean", nullable: false, default: true } }),
      timestampField("updated_at"),
    ],
  },
  {
    collection: "faqs",
    meta: { ...baseMeta, icon: "help" },
    fields: [
      textField("question", { schema: { data_type: "text", nullable: false } }),
      textField("answer"),
      m2oField("brand_id", "brands"),
      m2oField("city_id", "cities"),
      m2oField("store_id", "stores"),
      m2oField("category_id", "categories"),
      integerField("sort_order", { schema: { data_type: "integer", nullable: false, default: 0 } }),
      booleanField("active", { schema: { data_type: "boolean", nullable: false, default: true } }),
    ],
  },
  {
    collection: "vacancies",
    meta: { ...baseMeta, icon: "work" },
    fields: [
      m2oField("brand_id", "brands"),
      m2oField("store_id", "stores"),
      stringField("title", { schema: { data_type: "varchar", length: 255, nullable: false } }),
      integerField("salary_from"),
      integerField("salary_to"),
      stringField("schedule"),
      stringField("employment_type"),
      textField("description"),
      textField("requirements"),
      stringField("contact"),
      booleanField("active", { schema: { data_type: "boolean", nullable: false, default: true } }),
      timestampField("published_at"),
      timestampField("created_at"),
      timestampField("updated_at"),
    ],
  },
  {
    collection: "actual_items",
    meta: { ...baseMeta, icon: "campaign" },
    fields: [
      stringField("type", { schema: { data_type: "varchar", length: 32, nullable: false } }),
      m2oField("brandId", "brands"),
      stringField("title", { schema: { data_type: "varchar", length: 255, nullable: false } }),
      textField("shortText"),
      fileField("image"),
      stringField("imageAlt"),
      stringField("imageOrientation", { schema: { data_type: "varchar", length: 16, nullable: true } }),
      stringField("badge"),
      stringField("buttonText"),
      stringField("buttonUrl"),
      timestampField("startsAt"),
      timestampField("endsAt"),
      integerField("priority", { schema: { data_type: "integer", nullable: false, default: 0 } }),
      booleanField("active", { schema: { data_type: "boolean", nullable: false, default: true } }),
      booleanField("showOnHome", { schema: { data_type: "boolean", nullable: true, default: true } }),
    ],
  },
];

const primaryKeyField: FieldSpec = {
  field: "id",
  type: "uuid",
  meta: { hidden: true, interface: "input", special: null, width: "full" },
  schema: { is_primary_key: true, has_auto_increment: false, nullable: false },
};

async function ensureCollection(client: DirectusAdminClient, spec: CollectionSpec) {
  console.log(`Ensuring collection: ${spec.collection}`);
  try {
    await client.post("/collections", {
      collection: spec.collection,
      meta: { ...baseMeta, ...spec.meta },
      schema: { name: spec.collection, ...(spec.schema ?? {}) },
      fields: [primaryKeyField],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("already exists") || message.includes("Duplicate")) {
      console.log(`  Collection ${spec.collection} already exists, skipping creation.`);
    } else {
      throw error;
    }
  }

  for (const field of spec.fields) {
    console.log(`  Ensuring field: ${field.field}`);
    try {
      await client.post(`/fields/${spec.collection}`, {
        collection: spec.collection,
        field: field.field,
        type: field.type,
        meta: field.meta,
        schema: field.schema,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("already exists") || message.includes("Duplicate")) {
        console.log(`    Field ${field.field} already exists, skipping.`);
      } else {
        throw error;
      }
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
      if (message.includes("already exists") || message.includes("Duplicate")) {
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

  for (const spec of schema) {
    await ensureCollection(client, spec);
  }

  console.log("Schema apply complete.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
