# Stores Web Platform Architecture

## Context and scope

The platform gives Amper, Ventil, Metiz Market, and Miska a shared technical foundation while preserving each as an independent brand. V1 publishes location and institutional content for Amursk. It has no catalog, products, prices, stock, cart, payment, reservation, delivery, personal account, customer bonus balance, 1C integration, or AI agent.

The platform is mobile-first, CMS-ready, API-ready, and designed to add cities and physical stores without changing its core model.

## Domain boundaries

### Brand versus Store

`Brand` owns identity: name, official logo, colors, editorial descriptions, social links, and brand SEO. It is not an address.

`Store` is a physical trading point. It belongs to one brand and one city and owns address, contacts, hours, coordinates, photos, map links, closure state, and local SEO. A brand may have many stores in one city and across many cities.

No parent consumer brand is invented. Home structured data describes four real organizations in a graph rather than a fictional fifth organization.

### City

`City` is a reusable locality record. Routes use the city slug, while relations use an immutable ID. V1 has Amursk in Khabarovsk Krai, Russia. New cities require data records, not a new store schema.

### Category

`Category` belongs to a brand and may reference a parent category. In V1, categories communicate business directions and improve semantic discovery. They are not a hidden catalog and do not imply products, offers, prices, or stock.

### Promotion

`Promotion` can be scoped to a brand, a city, one store, or multiple stores. Scope is modeled through relations rather than copied strings. A publication workflow must validate dates, terms, and scope before `active` is set.

Bonus programs, FAQ entries, and vacancies use the same explicit relation approach. Bonus content never contains customer accounts or balances.

## Runtime architecture

```text
Browser / crawler
       |
       v
Next.js App Router (server HTML, metadata, BFF)
       |
       v
Typed repository modules in lib/directus
       |
       v
Directus HTTP API
       |
       v
PostgreSQL
```

Next.js components depend on typed domain objects, not Directus response mechanics. Native server-side `fetch` provides caching and tag hooks. When CMS configuration is absent, the repository uses an explicit non-production mock layer containing only facts from the specification and visible placeholders for unknown values.

Docker Compose runs `web`, `directus`, and `postgres` separately. PostgreSQL is not exposed to the host. Directus credentials and database credentials exist only in environment variables.

## URL strategy

Stable brand slugs live at the root: `/amper/`, `/ventil/`, `/metiz-market/`, and `/miska/`. Location discovery is city-first: `/stores/{city}/`, then `/stores/{city}/{store}/`. This keeps a store address independent from its brand landing page and permits many stores per brand and city.

Shared institutional routes retain the specified Russian transliterated paths. Catalog routes are reserved for a later phase and will use `/catalog/{brand}/{category}/...` without changing current URLs.

## SEO strategy

The Next.js Metadata API provides a unique title, description, canonical, Open Graph data, and robots policy for every indexable page. All pages have one contextual H1 and semantic sections. The sitemap reads active entities through the same repository used by pages and excludes API, admin, preview, draft, inactive, and temporarily unpublished content.

Legal pages currently contain explicit placeholders. They are public for route completeness but remain `noindex` and outside the sitemap until approved legal content is supplied.

## Local SEO and structured data

Home emits `WebSite` plus one `Organization` node for each actual brand. Store pages emit a business node linked to its brand and a `PostalAddress` with verified locality. Coordinates, telephone, street address, postal code, and opening-hours specifications are omitted when unavailable instead of being guessed.

The store contract allows a verified specific Schema.org type. Miska uses `PetStore` while its actual business remains a pet store. Amper and Metiz Market can use `HardwareStore`; Ventil can use `HomeGoodsStore`; uncertain cases fall back to `LocalBusiness`.

## AI Search and crawlability

Business names, specialization, city, address state, telephone state, hours state, categories, FAQ, promotions, and vacancies render in Server Components. Crawlers do not need hydration to discover critical content. Normal anchors, buttons, labels, landmarks, headings, and accessible disclosure elements preserve machine and human navigation.

`robots.txt` explicitly allows OAI-SearchBot while applying the same private-path exclusions used for general crawlers. There is no crawler-specific content variation.

## API boundary

The browser never treats Directus as the site's public application API. Next.js owns the BFF at `/api/*`; it can project fields, normalize errors, add authorization, rate limits, cache policy, and contract versioning independently of CMS internals.

V1 offers read-only collection endpoints for brands, cities, stores, promotions, categories, and vacancies. The UI uses server-side repository functions directly when rendering, so these endpoints exist for integrations and future clients rather than forcing an unnecessary browser round trip.

Arthur can later consume versioned Website API contracts for brands, stores, cities, categories, promotions, and, after a separately approved catalog phase, products, prices, and stock. No Arthur agent is implemented here.

## IndexNow and content changes

The `services/indexnow.ts` adapter accepts changed URLs, resolves them against a trusted configured origin, deduplicates them, and submits only when explicitly invoked with an environment-provided key. A later authenticated Directus webhook handler should:

1. validate the webhook signature and content event;
2. map the changed entity to canonical public URLs;
3. invalidate only relevant Next.js cache tags;
4. call the IndexNow adapter;
5. record a redacted operational result.

No public IndexNow or revalidation endpoint exists in V1.

## Security

Production terminates HTTPS at trusted infrastructure. Next.js sets content-type, frame, referrer, and permissions headers. Secrets remain server-only environment variables. Directus receives a least-privilege database account; the web service receives, at most, a read-only Directus token. API errors expose stable public codes and log only collection-level context, never credentials or personal data.

Directus admin, preview routes, private APIs, and framework assets are excluded from search indexing. Production hardening must also add reverse-proxy rate limits, trusted-host enforcement, backups, patch management, webhook authentication, and a deployment-specific Content Security Policy.

## Future catalog

Catalog implementation is a separate bounded project. It will add Product and Offer contracts only after sources, ownership, price precision, stock freshness, synchronization rules, and publication policy are approved. Existing `Category` records can become catalog navigation nodes, but V1 never fabricates product data.

## Future 1C integration

The required future flow is:

```text
1C
 |
 v
Integration service
 |
 v
Catalog database / storage
 |
 v
Website API
 |
 v
Next.js / Arthur
```

The integration service isolates 1C protocols, credentials, retries, mapping, validation, reconciliation, and idempotency. The public frontend and Arthur never connect directly to the 1C server. Website API responses must expose source timestamps and stock freshness so downstream consumers do not treat stale data as current.

## Scaling rules

- Add a store by data relation, not by duplicating a brand page.
- Add a city as a city record and city-scoped content.
- Add a brand through the shared contract and page template, with an explicit stable route decision.
- Keep deterministic scope and publication validation outside prompts.
- Introduce shared abstractions only after real duplication.
- Keep commerce and customer-account capabilities outside V1 until separately approved.
