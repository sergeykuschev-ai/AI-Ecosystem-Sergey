import type { Brand } from "@/types/brand";
import type { Category } from "@/types/category";
import type { City } from "@/types/city";
import type { FAQ } from "@/types/faq";
import type { Promotion } from "@/types/promotion";
import type { Store } from "@/types/store";
import type { Vacancy } from "@/types/vacancy";
import type { BonusProgram } from "@/types/bonus-program";
import type { ActualItem } from "@/types/actual-item";
import { normalizeFile, normalizeRelationId } from "./normalize";

function asIsoString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return new Date().toISOString();
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function asStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value);
  return str.length > 0 ? str : null;
}

function asNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isNaN(num) ? null : num;
}

function asBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value : [];
}

export function normalizeBrand(raw: Record<string, unknown>): Brand {
  return {
    id: asString(raw.id),
    slug: asString(raw.slug),
    name: asString(raw.name),
    legal_name: asStringOrNull(raw.legal_name),
    logo: normalizeFile(raw.logo as never),
    primary_color: asString(raw.primary_color),
    secondary_color: asString(raw.secondary_color),
    short_description: asString(raw.short_description),
    description: asString(raw.description),
    seo_title: asString(raw.seo_title),
    seo_description: asString(raw.seo_description),
    social_links: asArray(raw.social_links),
    active: asBoolean(raw.active),
    created_at: asIsoString(raw.created_at),
    updated_at: asIsoString(raw.updated_at),
  };
}

export function normalizeCity(raw: Record<string, unknown>): City {
  return {
    id: asString(raw.id),
    slug: asString(raw.slug),
    name: asString(raw.name),
    region: asString(raw.region),
    country: asString(raw.country),
    latitude: asNumberOrNull(raw.latitude),
    longitude: asNumberOrNull(raw.longitude),
    active: asBoolean(raw.active),
    created_at: asIsoString(raw.created_at),
    updated_at: asIsoString(raw.updated_at),
  };
}

export function normalizeStore(raw: Record<string, unknown>): Store {
  return {
    id: asString(raw.id),
    brand_id: normalizeRelationId(raw.brand_id as never) ?? "",
    city_id: normalizeRelationId(raw.city_id as never) ?? "",
    name: asString(raw.name),
    slug: asString(raw.slug),
    address: asStringOrNull(raw.address),
    postal_code: asStringOrNull(raw.postal_code),
    latitude: asNumberOrNull(raw.latitude),
    longitude: asNumberOrNull(raw.longitude),
    telephone: asStringOrNull(raw.telephone),
    email: asStringOrNull(raw.email),
    opening_hours: asArray(raw.opening_hours),
    short_description: asString(raw.short_description),
    description: asString(raw.description),
    facade_photo: normalizeFile(raw.facade_photo as never),
    entrance_photo: normalizeFile(raw.entrance_photo as never),
    gallery: asArray<string>(raw.gallery)
      .map((id) => normalizeFile(id))
      .filter((url): url is string => Boolean(url)),
    map_links: asArray(raw.map_links),
    messenger_links: asArray(raw.messenger_links),
    active: asBoolean(raw.active),
    temporarily_closed: asBoolean(raw.temporarily_closed),
    seo_title: asString(raw.seo_title),
    seo_description: asString(raw.seo_description),
    created_at: asIsoString(raw.created_at),
    updated_at: asIsoString(raw.updated_at),
  };
}

export function normalizeCategory(raw: Record<string, unknown>): Category {
  return {
    id: asString(raw.id),
    brand_id: normalizeRelationId(raw.brand_id as never) ?? "",
    parent_id: normalizeRelationId(raw.parent_id as never),
    name: asString(raw.name),
    slug: asString(raw.slug),
    short_description: asString(raw.short_description),
    description: asString(raw.description),
    image: normalizeFile(raw.image as never),
    sort_order: Number(raw.sort_order ?? 0),
    active: asBoolean(raw.active),
    created_at: asIsoString(raw.created_at),
    updated_at: asIsoString(raw.updated_at),
  };
}

export function normalizePromotion(raw: Record<string, unknown>): Promotion {
  return {
    id: asString(raw.id),
    title: asString(raw.title),
    slug: asString(raw.slug),
    brand_id: normalizeRelationId(raw.brand_id as never),
    city_id: normalizeRelationId(raw.city_id as never),
    store_ids: asArray<string>(raw.store_ids),
    start_date: asStringOrNull(raw.start_date),
    end_date: asStringOrNull(raw.end_date),
    short_description: asString(raw.short_description),
    description: asString(raw.description),
    image: normalizeFile(raw.image as never),
    terms: asString(raw.terms),
    active: asBoolean(raw.active),
    seo_title: asString(raw.seo_title),
    seo_description: asString(raw.seo_description),
    created_at: asIsoString(raw.created_at),
    updated_at: asIsoString(raw.updated_at),
  };
}

export function normalizeBonusProgram(raw: Record<string, unknown>): BonusProgram {
  return {
    id: asString(raw.id),
    title: asString(raw.title),
    short_description: asString(raw.short_description),
    description: asString(raw.description),
    rules: asArray(raw.rules),
    participating_brands: asArray<string>(raw.participating_brands),
    faq: asArray(raw.faq).map((item) => normalizeFaq(item as Record<string, unknown>)),
    active: asBoolean(raw.active),
    updated_at: asIsoString(raw.updated_at),
  };
}

export function normalizeFaq(raw: Record<string, unknown>): FAQ {
  return {
    id: asString(raw.id),
    question: asString(raw.question),
    answer: asString(raw.answer),
    brand_id: normalizeRelationId(raw.brand_id as never),
    city_id: normalizeRelationId(raw.city_id as never),
    store_id: normalizeRelationId(raw.store_id as never),
    category_id: normalizeRelationId(raw.category_id as never),
    sort_order: Number(raw.sort_order ?? 0),
    active: asBoolean(raw.active),
  };
}

export function normalizeVacancy(raw: Record<string, unknown>): Vacancy {
  return {
    id: asString(raw.id),
    brand_id: normalizeRelationId(raw.brand_id as never) ?? "",
    store_id: normalizeRelationId(raw.store_id as never),
    title: asString(raw.title),
    salary_from: asNumberOrNull(raw.salary_from),
    salary_to: asNumberOrNull(raw.salary_to),
    schedule: asStringOrNull(raw.schedule),
    employment_type: asStringOrNull(raw.employment_type),
    description: asString(raw.description),
    requirements: asString(raw.requirements),
    contact: asStringOrNull(raw.contact),
    active: asBoolean(raw.active),
    published_at: asStringOrNull(raw.published_at),
    created_at: asIsoString(raw.created_at),
    updated_at: asIsoString(raw.updated_at),
  };
}

export function normalizeActualItem(raw: Record<string, unknown>): ActualItem {
  return {
    id: asString(raw.id),
    type: asString(raw.type) as ActualItem["type"],
    brandId: normalizeRelationId(raw.brandId as never),
    title: asString(raw.title),
    shortText: asString(raw.shortText),
    image: normalizeFile(raw.image as never),
    imageAlt: asStringOrNull(raw.imageAlt),
    imageOrientation: raw.imageOrientation === "portrait" ? "portrait" : "landscape",
    badge: asStringOrNull(raw.badge),
    buttonText: asStringOrNull(raw.buttonText),
    buttonUrl: asStringOrNull(raw.buttonUrl),
    startsAt: asStringOrNull(raw.startsAt),
    endsAt: asStringOrNull(raw.endsAt),
    priority: Number(raw.priority ?? 0),
    active: asBoolean(raw.active),
    showOnHome: raw.showOnHome === undefined ? undefined : asBoolean(raw.showOnHome),
  };
}
