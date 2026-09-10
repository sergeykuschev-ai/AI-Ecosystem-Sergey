/**
 * Read-only production SEO/indexation audit for https://amurskmarket.ru (issue #85).
 *
 * Sends only anonymous GET requests to public endpoints. It never writes to
 * production, Directus, the database, or any search-engine endpoint, and it
 * never submits IndexNow URLs — IndexNow checks are configuration/readiness
 * checks only.
 *
 * Run manually:
 *   npm run audit:seo
 *
 * Optional: AUDIT_BASE_URL=https://staging.example.com npm run audit:seo
 */

interface FetchResult {
  status: number;
  location: string | null;
  contentType: string;
  body: string;
}

interface PageSnapshot {
  path: string;
  status: number;
  canonical: string | null;
  title: string | null;
  description: string | null;
  robotsMeta: string | null;
  ogUrl: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  jsonLd: unknown[];
}

interface AuditFinding {
  ok: boolean;
  severity: "error" | "warning";
  scope: string;
  message: string;
}

const DEFAULT_BASE_URL = "https://amurskmarket.ru";
const REQUEST_TIMEOUT_MS = 15_000;
const USER_AGENT = "stores-web-seo-audit/1.1 (+read-only)";

const STATIC_PUBLIC_PATHS = [
  "/",
  "/stores/",
  "/akcii/",
  "/bonus/",
  "/vakansii/",
  "/o-kompanii/",
  "/kontakty/",
  "/faq/",
];

const BRAND_PATHS = ["/amper/", "/ventil/", "/metiz-market/", "/miska/"];

const LEGAL_PATHS = ["/politika-konfidencialnosti/", "/soglasie-na-obrabotku-dannyh/"];

const PRIVATE_PATH_FRAGMENTS = ["/api/", "/admin/", "/preview/", "/directus/", "/_next/"];

const ROBOTS_DISALLOW_EXPECTED = ["/api/", "/admin/", "/preview/", "/directus/", "/_next/"];

function resolveBaseUrl(): URL {
  const raw = process.env.AUDIT_BASE_URL ?? DEFAULT_BASE_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`AUDIT_BASE_URL is not a valid URL: "${raw}"`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`AUDIT_BASE_URL must use http or https: "${raw}"`);
  }
  return url;
}

async function fetchPath(baseUrl: URL, path: string, redirect: "follow" | "manual" = "follow"): Promise<FetchResult> {
  const response = await fetch(new URL(path, baseUrl), {
    method: "GET",
    redirect,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { accept: "text/html,application/xhtml+xml,application/xml,text/xml,text/plain,*/*", "user-agent": USER_AGENT },
  });
  return {
    status: response.status,
    location: response.headers.get("location"),
    contentType: response.headers.get("content-type") ?? "",
    body: await response.text(),
  };
}

function extractTag(body: string, pattern: RegExp): string | null {
  const match = body.match(pattern);
  return match?.[1]?.trim() ?? null;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractJsonLdBlocks(body: string): unknown[] {
  const blocks: unknown[] = [];
  const pattern = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
  for (const match of body.matchAll(pattern)) {
    try {
      blocks.push(JSON.parse(decodeEntities(match[1])));
    } catch {
      blocks.push({ __unparseable: true });
    }
  }
  return blocks;
}

function collectTypes(node: unknown, into: Set<string>) {
  if (Array.isArray(node)) {
    for (const item of node) collectTypes(item, into);
    return;
  }
  if (node && typeof node === "object") {
    const record = node as Record<string, unknown>;
    if (typeof record["@type"] === "string") into.add(record["@type"]);
    if (typeof record["@type"] === "object") collectTypes(record["@type"], into);
    if ("@graph" in record) collectTypes(record["@graph"], into);
  }
}

// Schema.org LocalBusiness subtypes emitted by createStoreJsonLd.
const LOCAL_BUSINESS_SUBTYPES = new Set([
  "LocalBusiness",
  "Store",
  "PetStore",
  "HardwareStore",
  "HomeGoodsStore",
]);

function hasJsonLdType(present: Set<string>, expected: string): boolean {
  if (present.has(expected)) return true;
  if (expected === "LocalBusiness") {
    for (const subtype of LOCAL_BUSINESS_SUBTYPES) {
      if (present.has(subtype)) return true;
    }
  }
  return false;
}

function snapshotPage(path: string, result: FetchResult): PageSnapshot {
  return {
    path,
    status: result.status,
    canonical: extractTag(result.body, /<link[^>]*rel="canonical"[^>]*href="([^"]*)"/),
    title: extractTag(result.body, /<title[^>]*>([\s\S]*?)<\/title>/),
    description: extractTag(result.body, /<meta[^>]*name="description"[^>]*content="([^"]*)"/),
    robotsMeta: extractTag(result.body, /<meta[^>]*name="robots"[^>]*content="([^"]*)"/),
    ogUrl: extractTag(result.body, /<meta[^>]*property="og:url"[^>]*content="([^"]*)"/),
    ogTitle: extractTag(result.body, /<meta[^>]*property="og:title"[^>]*content="([^"]*)"/),
    ogDescription: extractTag(result.body, /<meta[^>]*property="og:description"[^>]*content="([^"]*)"/),
    ogImage: extractTag(result.body, /<meta[^>]*property="og:image"[^>]*content="([^"]*)"/),
    jsonLd: extractJsonLdBlocks(result.body),
  };
}

function expectJsonLdTypes(snapshot: PageSnapshot, expected: string[], findings: AuditFinding[]) {
  const present = new Set<string>();
  for (const block of snapshot.jsonLd) {
    if ((block as { __unparseable?: boolean }).__unparseable) {
      findings.push({ ok: false, severity: "error", scope: snapshot.path, message: "contains an unparseable JSON-LD block" });
      continue;
    }
    collectTypes(block, present);
  }
  for (const type of expected) {
    findings.push({
      ok: hasJsonLdType(present, type),
      severity: "error",
      scope: snapshot.path,
      message: `JSON-LD must contain a ${type} node (found: ${[...present].join(", ") || "none"})`,
    });
  }
}

async function main(): Promise<void> {
  const baseUrl = resolveBaseUrl();
  const origin = baseUrl.origin;
  const findings: AuditFinding[] = [];
  const note = (scope: string, message: string) => findings.push({ ok: true, severity: "warning", scope, message });

  console.log(`SEO/indexation audit against ${origin} (read-only, anonymous GET only, no IndexNow submissions)`);

  // --- robots.txt ---
  const robots = await fetchPath(baseUrl, "/robots.txt");
  findings.push({ ok: robots.status === 200, severity: "error", scope: "/robots.txt", message: `expected HTTP 200, got ${robots.status}` });
  const robotsBody = robots.body.toLowerCase();
  for (const privatePath of ROBOTS_DISALLOW_EXPECTED) {
    findings.push({
      ok: robotsBody.includes(`disallow: ${privatePath}`),
      severity: "error",
      scope: "/robots.txt",
      message: `must disallow ${privatePath}`,
    });
  }
  findings.push({
    ok: /disallow:\s*\/\s*$/m.test(robots.body) === false,
    severity: "error",
    scope: "/robots.txt",
    message: "must not contain a full-site Disallow: /",
  });
  const sitemapLine = robots.body.match(/^Sitemap:\s*(\S+)$/im)?.[1] ?? null;
  findings.push({
    ok: sitemapLine === new URL("/sitemap.xml", origin).href,
    severity: "error",
    scope: "/robots.txt",
    message: `Sitemap directive must be ${new URL("/sitemap.xml", origin).href}, got ${sitemapLine ?? "none"}`,
  });
  findings.push({
    ok: !robotsBody.includes(".txt"),
    severity: "error",
    scope: "/robots.txt",
    message: "robots.txt must not block the IndexNow key file (*.txt)",
  });

  // --- sitemap.xml ---
  const sitemap = await fetchPath(baseUrl, "/sitemap.xml");
  findings.push({ ok: sitemap.status === 200, severity: "error", scope: "/sitemap.xml", message: `expected HTTP 200, got ${sitemap.status}` });
  const sitemapUrls = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1].trim());
  findings.push({ ok: sitemapUrls.length > 0, severity: "error", scope: "/sitemap.xml", message: "must contain at least one URL" });
  for (const url of sitemapUrls) {
    findings.push({ ok: new URL(url).origin === origin, severity: "error", scope: "/sitemap.xml", message: `URL ${url} leaves the site origin` });
    for (const privatePath of [...PRIVATE_PATH_FRAGMENTS, ...LEGAL_PATHS]) {
      findings.push({ ok: !url.includes(privatePath), severity: "error", scope: "/sitemap.xml", message: `URL ${url} must not include ${privatePath}` });
    }
    findings.push({ ok: url === origin || url.endsWith("/"), severity: "error", scope: "/sitemap.xml", message: `URL ${url} must use the canonical trailing-slash form` });
  }
  const sitemapUrlSet = new Set(sitemapUrls);

  // --- public pages ---
  const pagePaths = [...STATIC_PUBLIC_PATHS, ...BRAND_PATHS];
  const snapshots: PageSnapshot[] = [];
  for (const path of pagePaths) {
    const result = await fetchPath(baseUrl, path);
    const snapshot = snapshotPage(path, result);
    snapshots.push(snapshot);

    findings.push({ ok: snapshot.status === 200, severity: "error", scope: path, message: `expected HTTP 200, got ${snapshot.status}` });
    const expectedCanonical = new URL(path, origin).href;
    findings.push({ ok: snapshot.canonical === expectedCanonical, severity: "error", scope: path, message: `canonical must be ${expectedCanonical}, got ${snapshot.canonical ?? "none"}` });
    findings.push({ ok: Boolean(snapshot.title), severity: "error", scope: path, message: "title must be non-empty" });
    findings.push({ ok: Boolean(snapshot.description), severity: "error", scope: path, message: "meta description must be non-empty" });
    findings.push({
      ok: snapshot.robotsMeta == null || !/noindex/i.test(snapshot.robotsMeta),
      severity: "error",
      scope: path,
      message: `public page must not be noindex (robots meta: ${snapshot.robotsMeta ?? "none"})`,
    });
    findings.push({ ok: snapshot.ogUrl === expectedCanonical, severity: "error", scope: path, message: `og:url must be ${expectedCanonical}, got ${snapshot.ogUrl ?? "none"}` });
    findings.push({ ok: Boolean(snapshot.ogTitle), severity: "error", scope: path, message: "og:title must be non-empty" });
    findings.push({ ok: Boolean(snapshot.ogDescription), severity: "error", scope: path, message: "og:description must be non-empty" });
    findings.push({ ok: Boolean(snapshot.ogImage), severity: "error", scope: path, message: "og:image must be present" });

    if (snapshot.title && snapshot.title.length > 70) {
      note(path, `title is ${snapshot.title.length} chars (>70 may truncate in SERP)`);
    }
    if (snapshot.description && (snapshot.description.length < 50 || snapshot.description.length > 160)) {
      note(path, `description is ${snapshot.description.length} chars (recommended 50–160)`);
    }
  }

  const jsonLdExpectations: Array<[RegExp, string[]]> = [
    [/^\/$/, ["WebSite", "Organization"]],
    [/^\/(amper|ventil|metiz-market|miska)\/$/, ["Organization"]],
    [/^\/kontakty\/$/, ["ContactPage", "LocalBusiness"]],
    [/^\/o-kompanii\/$/, ["AboutPage"]],
    [/^\/faq\/$/, ["FAQPage"]],
    [/^\/stores\/[^/]+\/$/, ["LocalBusiness"]],
    [/^\/stores\/[^/]+\/[^/]+\/$/, ["BreadcrumbList"]],
  ];
  for (const snapshot of snapshots) {
    for (const [pattern, expected] of jsonLdExpectations) {
      if (pattern.test(snapshot.path)) expectJsonLdTypes(snapshot, expected, findings);
    }
  }

  // --- dynamic routes from the sitemap (city and store pages) ---
  const dynamicPaths = [...sitemapUrlSet]
    .map((url) => new URL(url).pathname)
    .filter((path) => path.startsWith("/stores/") && path !== "/stores/");
  for (const path of dynamicPaths) {
    const result = await fetchPath(baseUrl, path);
    const snapshot = snapshotPage(path, result);
    snapshots.push(snapshot);
    findings.push({ ok: snapshot.status === 200, severity: "error", scope: path, message: `expected HTTP 200, got ${snapshot.status}` });
    findings.push({ ok: snapshot.canonical === new URL(path, origin).href, severity: "error", scope: path, message: `canonical mismatch: ${snapshot.canonical ?? "none"}` });
    findings.push({ ok: Boolean(snapshot.title) && Boolean(snapshot.description), severity: "error", scope: path, message: "title and description must be non-empty" });
    findings.push({
      ok: snapshot.robotsMeta == null || !/noindex/i.test(snapshot.robotsMeta),
      severity: "error",
      scope: path,
      message: `public page must not be noindex (robots meta: ${snapshot.robotsMeta ?? "none"})`,
    });
    for (const [pattern, expected] of jsonLdExpectations) {
      if (pattern.test(path)) expectJsonLdTypes(snapshot, expected, findings);
    }
  }

  // --- sitemap coverage: every static/brand page must be in the sitemap ---
  for (const path of [...STATIC_PUBLIC_PATHS, ...BRAND_PATHS]) {
    findings.push({
      ok: sitemapUrlSet.has(new URL(path, origin).href),
      severity: "error",
      scope: "/sitemap.xml",
      message: `sitemap must include ${new URL(path, origin).href}`,
    });
  }

  // --- legal pages must stay noindex and out of the sitemap ---
  for (const path of LEGAL_PATHS) {
    const snapshot = snapshotPage(path, await fetchPath(baseUrl, path));
    findings.push({ ok: snapshot.status === 200, severity: "error", scope: path, message: `expected HTTP 200, got ${snapshot.status}` });
    findings.push({
      ok: snapshot.robotsMeta != null && /noindex/i.test(snapshot.robotsMeta),
      severity: "error",
      scope: path,
      message: `legal page must be noindex (robots meta: ${snapshot.robotsMeta ?? "none"})`,
    });
    findings.push({
      ok: !sitemapUrlSet.has(new URL(path, origin).href),
      severity: "error",
      scope: "/sitemap.xml",
      message: `sitemap must exclude ${new URL(path, origin).href}`,
    });
  }

  // --- redirects and trailing slash (all discovered public routes) ---
  const canonicalPagePaths = new Set([
    ...STATIC_PUBLIC_PATHS,
    ...BRAND_PATHS,
    ...LEGAL_PATHS,
    ...dynamicPaths,
  ]);
  for (const canonicalPath of canonicalPagePaths) {
    if (canonicalPath === "/") continue;
    const path = canonicalPath.slice(0, -1);
    const result = await fetchPath(baseUrl, path, "manual");
    const expectedTarget = new URL(canonicalPath, origin).href;
    const actualTarget = result.location ? new URL(result.location, origin).href : null;
    findings.push({
      ok: result.status === 308 && actualTarget === expectedTarget,
      severity: "error",
      scope: path,
      message: `extensionless URL must return one 308 to ${expectedTarget}, got status ${result.status} location ${result.location ?? "none"}`,
    });

    if (actualTarget === expectedTarget) {
      const target = await fetchPath(baseUrl, canonicalPath, "manual");
      const targetSnapshot = snapshotPage(canonicalPath, target);
      findings.push({
        ok: target.status === 200,
        severity: "error",
        scope: path,
        message: `redirect target ${expectedTarget} must return HTTP 200 without another redirect, got ${target.status}`,
      });
      findings.push({
        ok: targetSnapshot.canonical === expectedTarget,
        severity: "error",
        scope: path,
        message: `redirect target canonical must be ${expectedTarget}, got ${targetSnapshot.canonical ?? "none"}`,
      });
    }
  }
  const unknown = await fetchPath(baseUrl, `/definitely-not-a-page-${Date.now()}/`, "manual");
  findings.push({ ok: unknown.status === 404, severity: "error", scope: "/<unknown>/", message: `unknown route must return 404, got ${unknown.status}` });

  // --- IndexNow readiness (never submits anything) ---
  const probeKey = crypto.randomUUID();
  const keyProbe = await fetchPath(baseUrl, `/${probeKey}.txt`, "manual");
  findings.push({
    ok: keyProbe.status === 404,
    severity: "error",
    scope: `/${probeKey}.txt`,
    message: `unconfigured IndexNow key route must return 404, got ${keyProbe.status}`,
  });
  note("IndexNow", "key route returns 404 when unconfigured; submission path is manual/future webhook only — no URLs were submitted by this audit");

  // --- Open Graph image ---
  const ogImage = await fetchPath(baseUrl, "/opengraph-image.png");
  findings.push({ ok: ogImage.status === 200, severity: "error", scope: "/opengraph-image.png", message: `expected HTTP 200, got ${ogImage.status}` });
  findings.push({
    ok: ogImage.contentType.includes("image/png"),
    severity: "error",
    scope: "/opengraph-image.png",
    message: `expected image/png, got "${ogImage.contentType}"`,
  });

  // --- duplicate titles and descriptions across indexable pages ---
  const indexable = snapshots.filter((snapshot) => !(snapshot.robotsMeta && /noindex/i.test(snapshot.robotsMeta)));
  const canonicalOwners = new Map<string, string[]>();
  for (const snapshot of indexable) {
    if (!snapshot.canonical) continue;
    const owners = canonicalOwners.get(snapshot.canonical) ?? [];
    owners.push(snapshot.path);
    canonicalOwners.set(snapshot.canonical, owners);
  }
  for (const [canonical, paths] of canonicalOwners) {
    findings.push({
      ok: paths.length === 1,
      severity: "error",
      scope: paths.join(", "),
      message: `canonical ${canonical} is claimed by ${paths.length} public routes`,
    });
  }
  const byKey = (key: "title" | "description") => {
    const groups = new Map<string, string[]>();
    for (const snapshot of indexable) {
      const value = snapshot[key];
      if (!value) continue;
      const paths = groups.get(value) ?? [];
      paths.push(snapshot.path);
      groups.set(value, paths);
    }
    return [...groups.entries()].filter(([, paths]) => paths.length > 1);
  };
  for (const [value, paths] of byKey("title")) {
    findings.push({ ok: false, severity: "error", scope: paths.join(", "), message: `duplicate title "${value}" on ${paths.length} pages` });
  }
  for (const [value, paths] of byKey("description")) {
    findings.push({ ok: false, severity: "error", scope: paths.join(", "), message: `duplicate description "${value}" on ${paths.length} pages` });
  }

  // --- report ---
  let errors = 0;
  let warnings = 0;
  for (const finding of findings) {
    if (finding.ok && finding.severity === "warning") {
      warnings += 1;
      console.log(`NOTE ${finding.scope}: ${finding.message}`);
    } else if (finding.ok) {
      continue;
    } else {
      errors += 1;
      console.error(`FAIL ${finding.scope}: ${finding.message}`);
    }
  }
  console.log(`\n${findings.length - errors - warnings}/${findings.length - warnings} hard checks passed, ${warnings} informational notes`);
  if (errors > 0) {
    console.error(`${errors} check(s) FAILED`);
    process.exitCode = 1;
  } else {
    console.log("Audit result: PASS");
  }
}

main().catch((error: unknown) => {
  console.error(`SEO audit aborted: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

export {};
