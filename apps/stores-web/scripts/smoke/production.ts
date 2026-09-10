/**
 * Read-only production smoke-check for https://amurskmarket.ru.
 *
 * Sends only anonymous GET requests to public endpoints, verifies HTTP 200,
 * and asserts page markers so a false-positive 200 does not pass. It never
 * writes to production, Directus, the database, or any external service and
 * requires no credentials.
 *
 * Run manually after deploys:
 *   npm run smoke:production
 *
 * Optional: SMOKE_BASE_URL=https://staging.example.com npm run smoke:production
 */

interface PageCheck {
  path: string;
  /** Substrings that must appear in the response body. */
  markers: string[];
  /** Match markers case-insensitively (robots.txt field casing varies by server). */
  caseInsensitive?: boolean;
}

interface SmokeResult {
  path: string;
  ok: boolean;
  status: number;
  errors: string[];
}

const DEFAULT_BASE_URL = "https://amurskmarket.ru";
const REQUEST_TIMEOUT_MS = 15_000;
const MIN_OPENGRAPH_IMAGE_BYTES = 1_000;

const PAGE_CHECKS: PageCheck[] = [
  { path: "/", markers: ["Ампер, Вентиль, Метиз Маркет и Миска", "/amper/", "Бонусная"] },
  { path: "/amper/", markers: ["Ампер", "Проспект Победы"] },
  { path: "/ventil/", markers: ["Вентиль", "Проспект Победы"] },
  { path: "/metiz-market/", markers: ["Метиз Маркет", "Проспект Победы"] },
  { path: "/miska/", markers: ["Миска", "зоомагазин"] },
  { path: "/kontakty/", markers: ["Контакты", "Амурске"] },
  { path: "/bonus/", markers: ["Бонусная программа"] },
  { path: "/akcii/", markers: ["Акции"] },
  { path: "/vakansii/", markers: ["Вакансии"] },
  { path: "/faq/", markers: ["Частые вопросы"] },
  { path: "/o-kompanii/", markers: ["О компании"] },
  { path: "/stores/amursk/", markers: ["Магазины в", "Амурск"] },
  { path: "/sitemap.xml", markers: ["urlset", "https://amurskmarket.ru/"] },
  { path: "/robots.txt", markers: ["User-agent", "Sitemap:"], caseInsensitive: true },
];

function resolveBaseUrl(): URL {
  const raw = process.env.SMOKE_BASE_URL ?? DEFAULT_BASE_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`SMOKE_BASE_URL is not a valid URL: "${raw}"`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`SMOKE_BASE_URL must use http or https: "${raw}"`);
  }
  return url;
}

async function fetchText(baseUrl: URL, path: string): Promise<{ status: number; body: string; contentType: string }> {
  const response = await fetch(new URL(path, baseUrl), {
    method: "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { accept: "text/html,application/xhtml+xml,application/xml,text/xml,text/plain,*/*" },
  });
  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();
  return { status: response.status, body, contentType };
}

async function checkPage(baseUrl: URL, check: PageCheck): Promise<SmokeResult> {
  const errors: string[] = [];
  let status = 0;
  try {
    const { status: responseStatus, body } = await fetchText(baseUrl, check.path);
    status = responseStatus;
    if (responseStatus !== 200) {
      errors.push(`expected HTTP 200, got ${responseStatus}`);
    }
    const haystack = check.caseInsensitive ? body.toLowerCase() : body;
    for (const marker of check.markers) {
      const needle = check.caseInsensitive ? marker.toLowerCase() : marker;
      if (!haystack.includes(needle)) {
        errors.push(`missing marker: "${marker}"`);
      }
    }
  } catch (error) {
    errors.push(`request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { path: check.path, ok: errors.length === 0, status, errors };
}

async function checkOpenGraphImage(baseUrl: URL): Promise<SmokeResult> {
  const errors: string[] = [];
  let status = 0;
  try {
    const response = await fetch(new URL("/opengraph-image.png", baseUrl), {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    status = response.status;
    const bytes = (await response.arrayBuffer()).byteLength;
    if (status !== 200) {
      errors.push(`expected HTTP 200, got ${status}`);
    }
    if (!response.headers.get("content-type")?.includes("image/png")) {
      errors.push(`expected image/png content type, got "${response.headers.get("content-type") ?? "none"}"`);
    }
    if (bytes < MIN_OPENGRAPH_IMAGE_BYTES) {
      errors.push(`opengraph image too small: ${bytes} bytes`);
    }
  } catch (error) {
    errors.push(`request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { path: "/opengraph-image.png", ok: errors.length === 0, status, errors };
}

async function checkHealth(baseUrl: URL): Promise<SmokeResult> {
  const errors: string[] = [];
  let status = 0;
  try {
    const { status: responseStatus, body } = await fetchText(baseUrl, "/api/health");
    status = responseStatus;
    if (responseStatus !== 200) {
      errors.push(`expected HTTP 200, got ${responseStatus}`);
    }
    let payload: unknown = null;
    try {
      payload = JSON.parse(body);
    } catch {
      errors.push("response is not valid JSON");
    }
    if ((payload as { status?: unknown } | null)?.status !== "ok") {
      errors.push('expected JSON body {"status":"ok"}');
    }
  } catch (error) {
    errors.push(`request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { path: "/api/health", ok: errors.length === 0, status, errors };
}

async function main(): Promise<void> {
  const baseUrl = resolveBaseUrl();
  console.log(`Production smoke-check against ${baseUrl.origin} (read-only, anonymous GET only)`);

  const results: SmokeResult[] = [];
  for (const check of PAGE_CHECKS) {
    results.push(await checkPage(baseUrl, check));
  }
  results.push(await checkOpenGraphImage(baseUrl));
  results.push(await checkHealth(baseUrl));

  let failures = 0;
  for (const result of results) {
    if (result.ok) {
      console.log(`PASS ${result.path} (${result.status})`);
    } else {
      failures += 1;
      console.error(`FAIL ${result.path} (${result.status})`);
      for (const error of result.errors) {
        console.error(`     - ${error}`);
      }
    }
  }

  const total = results.length;
  console.log(`\n${total - failures}/${total} checks passed`);
  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(`Smoke-check aborted: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
