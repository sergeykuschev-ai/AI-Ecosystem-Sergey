# Stores Web Platform

This project is the public web foundation for four independent brands: Amper, Ventil, Metiz Market, and Miska. V1 operates in Amursk and deliberately excludes catalog and commerce functionality.

No umbrella brand or invented logo is introduced. Each brand has its own route, theme fields, content, and official logo referenced through the `Brand.logo` field.

## Stack

- Next.js 16.3.3, React 19.2.4, and TypeScript 5.9.2
- App Router and Server Components by default
- Directus 12.3.1 as the headless CMS
- PostgreSQL 17.6
- Docker Compose with separate `web`, `directus`, and `postgres` services

## Architecture

The frontend reads content through typed modules in `lib/directus/`. Components do not call Directus. With `CONTENT_SOURCE=mock`, a small development-only mock repository supplies the four specified brands, Amursk, placeholder stores, specified categories, FAQ content, and an unpublished-content state for promotions and vacancies. `CONTENT_SOURCE=directus` fails clearly when CMS configuration or availability is invalid; it never silently falls back to mock data.

The home-page “Actual” carousel reads `actual_items` through the same repository boundary. Publication windows and active state are enforced before data reaches the client component. The committed slides are explicitly labelled DEMO placeholders and contain no real commercial claims.

The public `/api/[resource]` route is a Next.js BFF boundary. It supports `brands`, `cities`, `stores`, `promotions`, `categories`, and `vacancies`; Directus credentials are never sent to browsers. Future authorization, field projection, rate limiting, and Arthur-specific contracts belong at this boundary.

See [Architecture](docs/ARCHITECTURE.md) and [Directus data model](docs/DATA_MODEL.md).

## Local development

Requirements: Node.js 20.9 or newer and npm.

```bash
cd apps/stores-web
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. Without a configured CMS, pages render from the explicit mock layer. Do not put real secrets in `.env.local`.

## Docker

Copy the example environment and replace every `replace-with-...` value before the first start:

```bash
cd apps/stores-web
cp .env.example .env
docker compose -f compose.yml up --build
```

The web app is available on port `3000`; Directus is available locally on port `8055`. PostgreSQL is not published to the host. Persistent data is stored in named Docker volumes.

The containers are version-pinned. Review release notes and update the pinned tags intentionally; never switch production configuration to `latest`.

## Environment variables

| Variable | Exposure | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Public | Trusted canonical origin for metadata, sitemap, and JSON-LD |
| `CONTENT_SOURCE` | Server only | Explicit content provider: `mock` or `directus` |
| `DIRECTUS_URL` | Server only | Directus HTTP origin |
| `DIRECTUS_SERVER_TOKEN` | Server only | Optional restricted read token; leave empty when the Directus public role is configured |
| `DIRECTUS_ADMIN_TOKEN` | Local scripts only | Admin/static token for schema apply and seed; never used by the Next.js runtime |
| `DIRECTUS_ADMIN_EMAIL` | Docker only | First Directus administrator email |
| `DIRECTUS_ADMIN_PASSWORD` | Docker only | First Directus administrator password |
| `DIRECTUS_KEY` / `DIRECTUS_SECRET` | Docker only | Directus cryptographic secrets |
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | Docker only | CMS database configuration |
| `INDEXNOW_KEY` | Server only | Optional IndexNow key |
| `INDEXNOW_ENDPOINT` | Server only | IndexNow endpoint override |

`.env`, `.env.local`, keys, certificates, uploads, and generated output are ignored by Git. The committed `.env.example` contains placeholders only.

## Routes

| Purpose | Route |
| --- | --- |
| Home | `/` |
| Brands | `/amper/`, `/ventil/`, `/metiz-market/`, `/miska/` |
| Cities and stores | `/stores/`, `/stores/amursk/`, `/stores/amursk/{store-slug}/` |
| Promotions | `/akcii/` |
| Bonus program | `/bonus/` |
| Vacancies | `/vakansii/` |
| About | `/o-kompanii/` |
| Contacts | `/kontakty/` |
| FAQ | `/faq/` |
| Legal placeholders | `/politika-konfidencialnosti/`, `/soglasie-na-obrabotku-dannyh/` |
| BFF | `/api/brands`, `/api/cities`, `/api/stores`, `/api/promotions`, `/api/categories`, `/api/vacancies` |
| Crawling | `/robots.txt`, `/sitemap.xml` |

The legal placeholder pages are intentionally `noindex` until approved legal text is supplied. They are therefore not in the sitemap.

## Directory structure

```text
app/                 App Router pages, metadata routes, and BFF
components/          Reusable layout, domain, SEO, and UI components
lib/analytics/       Provider-neutral event interface
lib/data/            Explicit development mock data
lib/directus/        Typed CMS access modules
lib/seo/             Metadata and JSON-LD generators
services/            Server-side integration services, including IndexNow
types/               Public domain entity contracts
docs/                Architecture and Directus model documentation
```

## Directus setup

### 1. Start the local stack

```bash
cd apps/stores-web
cp .env.example .env
# Replace every placeholder value in .env, then:
docker compose -f compose.yml up --build
```

Directus UI is available at `http://localhost:8055`. Sign in with the bootstrap credentials from `.env`.

### 2. Apply the schema

Instead of creating collections manually, apply the reproducible schema definition:

```bash
cd apps/stores-web
DIRECTUS_ADMIN_TOKEN=your-admin-token npm run directus:schema:apply
```

Use `DRY_RUN=1` to preview changes without API calls:

```bash
DRY_RUN=1 DIRECTUS_ADMIN_TOKEN=your-admin-token npm run directus:schema:apply
```

### 3. Seed V1 content

Load the current V1 data from `lib/data/mock-data.ts` into Directus:

```bash
cd apps/stores-web
DIRECTUS_ADMIN_TOKEN=your-admin-token npm run directus:seed
```

The seed is idempotent: it uses stable UUIDs derived from slugs and re-uses already uploaded files. `DRY_RUN=1` works here too.

### 4. Verify the data

```bash
cd apps/stores-web
DIRECTUS_ADMIN_TOKEN=your-admin-token npm run directus:check
```

### 5. Configure public access

Configure either a read-only public role or a narrowly scoped static token for the Next.js app. Never use the administrator token in the frontend runtime.

### 6. Switch the app to Directus

Create or update `.env.local` in `apps/stores-web`:

```bash
CONTENT_SOURCE=directus
DIRECTUS_URL=http://localhost:8055
DIRECTUS_SERVER_TOKEN=your-read-only-token
```

Restart the dev server. The UI, pages, and routes do not change; only the data source changes.

### 7. Roll back to mock data

To return to the committed V1 data without touching the database:

```bash
CONTENT_SOURCE=mock
```

Set this in `.env.local` and restart the dev server. Mock data remains the default in `.env.example` and in Docker Compose.

Directus collection details are isolated in `lib/directus/`; React components consume typed domain objects only.

## Content operations

### Update an official logo

Upload the approved official logo to Directus and set the brand's `logo` field to its asset URL. `BrandLogo` renders the verified asset through `next/image` with a contained, non-cropping layout. The page layout and brand routes do not change. Do not add a network-wide logo.

### Add a city

Create an active `cities` record with a unique slug and verified locality data. City and sitemap routes are generated from active records. Coordinates may remain null until verified.

### Add a brand

Create an active `brands` record, approved logo, colors, descriptions, and SEO fields. Add a deliberate public brand route because brand URLs are a stable product decision. Reuse `BrandPage`; do not duplicate its markup.

### Add a physical store

Create a `stores` record related to exactly one brand and one city. Use a slug unique within the city. Publish only verified address, phone, hours, coordinates, map links, and Schema.org type. The city listing, store page, JSON-LD, and sitemap then use the record.

### Add a promotion

Create an active `promotions` record and set its brand, city, and/or store scope. Supply exact dates and terms. A Directus webhook can later call a private revalidation handler and `services/indexnow.ts` with the affected canonical URLs.

## SEO, Local SEO, and AI search

Every public page uses the Metadata API for title, description, canonical, Open Graph, and robots settings. Home JSON-LD describes a `WebSite` and each actual brand as a separate `Organization`; there is no fabricated parent organization. Store JSON-LD emits the verified business type, `PostalAddress`, and conditionally emits telephone, coordinates, and opening hours only when present.

Critical brand, locality, store, category, FAQ, promotion, and vacancy content is server-rendered in semantic HTML. Navigation uses ordinary links, headings are hierarchical, focus is visible, and the layout supports 320 px viewports.

`robots.txt` allows normal crawling and does not block OAI-SearchBot. It excludes APIs, admin, preview, internal Directus routes, and framework assets. The dynamic sitemap includes active public records only.

## Analytics and IndexNow

`lib/analytics/` defines stable event names for phone, route, messenger, stock, brand, store, promotion, bonus, and vacancy interactions. Its default adapter is a no-op. A later Yandex Metrica or Google Analytics adapter can be installed without changing domain components.

`services/indexnow.ts` validates configuration, deduplicates URLs, applies the trusted site origin, enforces a timeout, and returns a small result contract. A dynamic root route serves `/{INDEXNOW_KEY}.txt` only when a key is configured. The service performs no requests unless explicitly called by future server-side webhook code.

## Future catalog

The category entity exists now, but there are no Product or Offer entities and no `/catalog/` pages. A later catalog should add dedicated catalog storage and contracts behind the Website API, then introduce `/catalog/{brand}/{category}/...` routes. Existing brand, city, and store contracts remain unchanged.

The public frontend must never connect directly to 1C. See the future integration flow in `docs/ARCHITECTURE.md`.

## Quality checks

```bash
npm run lint
npm run typecheck
npm run build
```
