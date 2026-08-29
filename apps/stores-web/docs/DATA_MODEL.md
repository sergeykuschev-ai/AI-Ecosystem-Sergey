# Directus data model

This document is the collection contract for the CMS. Directus collection names use plural snake case. UUID primary keys are recommended. Every public query must filter `active = true`; draft records remain private.

## Collections

### `brands`

`id`, `slug` (unique), `name`, `legal_name` (nullable), `logo` (file, nullable), `primary_color`, `secondary_color`, `short_description`, `description`, `seo_title`, `seo_description`, `social_links` (JSON array), `active`, `created_at`, `updated_at`.

### `cities`

`id`, `slug` (unique), `name`, `region`, `country`, `latitude` (decimal, nullable), `longitude` (decimal, nullable), `active`, `created_at`, `updated_at`.

Initial record: Amursk (`amursk`), Khabarovsk Krai, Russia. Coordinates remain empty until verified.

### `stores`

`id`, `brand_id` (M2O → `brands`), `city_id` (M2O → `cities`), `name`, `slug`, `address` (nullable), `postal_code` (nullable), `latitude` (decimal, nullable), `longitude` (decimal, nullable), `telephone` (nullable), `email` (nullable), `opening_hours` (JSON array), `short_description`, `description`, `facade_photo` (file, nullable), `entrance_photo` (file, nullable), `gallery` (M2M → files), `map_links` (JSON array), `messenger_links` (JSON array), `active`, `temporarily_closed`, `seo_title`, `seo_description`, `created_at`, `updated_at`.

Use a unique compound constraint on (`city_id`, `slug`). The JSON-LD generator maps the verified brand specialization to an approved Schema.org type and falls back to `LocalBusiness` when no more specific type is confirmed.

### `categories`

`id`, `brand_id` (M2O → `brands`), `parent_id` (self-referencing M2O, nullable), `name`, `slug`, `short_description`, `description`, `image` (file, nullable), `sort_order`, `active`, `created_at`, `updated_at`.

Use a unique compound constraint on (`brand_id`, `parent_id`, `slug`). Categories describe business directions in V1; they are not a product catalog.

### `promotions`

`id`, `title`, `slug` (unique), `brand_id` (M2O → `brands`, nullable), `city_id` (M2O → `cities`, nullable), `store_ids` (M2M → `stores`), `start_date` (nullable), `end_date` (nullable), `short_description`, `description`, `image` (file, nullable), `terms`, `active`, `seo_title`, `seo_description`, `created_at`, `updated_at`.

Scope rules allow a promotion to apply to a brand, a city, one store, or multiple stores. Application validation must reject a promotion with no meaningful scope unless it is explicitly approved as global.

### `bonus_programs`

`id`, `title`, `short_description`, `description`, `rules` (JSON array), `participating_brands` (M2M → `brands`), `faq` (O2M → `faqs`), `active`, `updated_at`. This collection stores published program content only; it never stores customer accounts or balances.

### `faqs`

`id`, `question`, `answer`, `brand_id` (nullable M2O), `city_id` (nullable M2O), `store_id` (nullable M2O), `category_id` (nullable M2O), `sort_order`, `active`.

### `vacancies`

`id`, `brand_id` (M2O → `brands`), `store_id` (nullable M2O → `stores`), `title`, `salary_from` (nullable decimal), `salary_to` (nullable decimal), `schedule` (nullable), `employment_type` (nullable), `description`, `requirements`, `contact` (nullable), `active`, `published_at` (nullable), `created_at`, `updated_at`.

### `actual_items`

`id`, `type` (`promotion`, `announcement`, `vacancy`, `bonus`, or `general`), `brandId` (nullable M2O → `brands`), `title`, `shortText`, `image` (file, nullable), `badge` (nullable), `buttonText` (nullable), `buttonUrl` (nullable), `startsAt` (datetime, nullable), `endsAt` (datetime, nullable), `priority` (integer), `active`.

This collection supplies the home-page “Actual” carousel. The repository filters inactive records, records scheduled for the future, expired records, and records with malformed date boundaries before rendering. Higher `priority` values appear first. `brandId` controls only the verified brand accent; a null value uses neutral platform UI styling and does not create another brand.

## Publication and validation

- Slugs are lowercase and URL-safe; public routes never use database IDs.
- Timestamps are UTC ISO 8601 values.
- Coordinates are decimal degrees and are published only as a verified pair.
- Empty phone, address, opening-hours, legal, promotion, or vacancy data stays nullable. The frontend never invents it.
- Directus roles expose only fields required by the website. Administrative fields and tokens remain server-only.
- A future webhook invalidates relevant Next.js cache tags and calls the IndexNow adapter with the changed canonical URLs.
