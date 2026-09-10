/**
 * Read-only production health diagnostics for https://amurskmarket.ru.
 *
 * One command for owner diagnostics and rollback verification. It sends only
 * anonymous GET requests and never writes to production, Directus, the
 * database, or any external service. No credentials are read or sent.
 *
 * What it checks, in order:
 *   1. Web reachability: the public home page responds with HTTP 200.
 *   2. Web health: /api/health returns {"status":"ok"}.
 *   3. Directus through the existing app boundary: every public /api/<resource>
 *      endpoint answers 200 with non-empty data, or explicitly reports
 *      UPSTREAM_UNAVAILABLE (HTTP 503) when Directus is failing.
 *   4. Directus direct reachability (optional): GET {DIRECTUS_URL}/server/ping
 *      must answer "pong". Only runs when DIRECTUS_URL is set; the public
 *      origin alone is enough for the web-vs-upstream distinction.
 *
 * The verdict distinguishes a web-layer problem from an upstream Directus
 * failure without exposing secrets:
 *   OK                  (exit 0) everything healthy
 *   WEB_DOWN            (exit 1) site unreachable at transport level
 *   WEB_ERROR           (exit 2) site answers but pages/health/app API broken
 *   DIRECTUS_UPSTREAM   (exit 3) web healthy, Directus failing behind the app
 *   CONTENT_DEGRADED    (exit 4) all services answer, public data is empty
 *
 * Run manually any time (after deploys, during incidents, after rollback):
 *   npm run diagnose:production
 *
 * Optional overrides:
 *   DIAGNOSTICS_BASE_URL=https://staging.example.com npm run diagnose:production
 *   DIAGNOSTICS_BASE_URL=... DIRECTUS_URL=https://cms.example.com npm run diagnose:production
 */

import {
  APP_BOUNDARY_RESOURCES,
  VERDICT_EXIT_CODES,
  VERDICT_SUMMARY,
  buildVerdict,
  classifyAppApiPayload,
  classifyAppApiStatus,
  classifyDirectusPing,
  classifyTransportFailure,
  classifyWebEndpoint,
  failedResult,
  okResult,
  skippedResult,
  REQUIRED_APP_BOUNDARY_RESOURCES,
  type DiagnosticResult,
} from "./checks";

const DEFAULT_BASE_URL = "https://amurskmarket.ru";
const REQUEST_TIMEOUT_MS = 15_000;

function resolveBaseUrl(): URL {
  const raw = process.env.DIAGNOSTICS_BASE_URL ?? DEFAULT_BASE_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`DIAGNOSTICS_BASE_URL is not a valid URL: "${raw}"`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`DIAGNOSTICS_BASE_URL must use http or https: "${raw}"`);
  }
  return url;
}

interface HttpResponse {
  status: number;
  body: string;
}

async function fetchText(baseUrl: URL, path: string): Promise<HttpResponse> {
  const response = await fetch(new URL(path, baseUrl), {
    method: "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { accept: "application/json,text/html,application/xhtml+xml,*/*" },
  });
  return { status: response.status, body: await response.text() };
}

function errorCodeOf(payload: unknown): string | null {
  const code = (payload as { error?: { code?: unknown } } | null)?.error?.code;
  return typeof code === "string" ? code : null;
}

async function checkHomePage(baseUrl: URL): Promise<DiagnosticResult> {
  const id = "web:home";
  const label = "public home page (web reachability)";
  try {
    const { status } = await fetchText(baseUrl, "/");
    if (status !== 200) {
      return failedResult(id, label, status, `expected HTTP 200, got ${status}`, classifyWebEndpoint(status));
    }
    return okResult(id, label, status);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failedResult(id, label, 0, `request failed: ${message}`, classifyTransportFailure("web"));
  }
}

async function checkApiHealth(baseUrl: URL): Promise<DiagnosticResult> {
  const id = "web:api-health";
  const label = "/api/health contract";
  try {
    const { status, body } = await fetchText(baseUrl, "/api/health");
    if (status !== 200) {
      return failedResult(id, label, status, `expected HTTP 200, got ${status}`, classifyWebEndpoint(status));
    }
    let payload: unknown = null;
    try {
      payload = JSON.parse(body);
    } catch {
      return failedResult(id, label, status, "response is not valid JSON", classifyWebEndpoint(status));
    }
    if ((payload as { status?: unknown } | null)?.status !== "ok") {
      return failedResult(id, label, status, 'expected JSON body {"status":"ok"}', classifyWebEndpoint(status));
    }
    return okResult(id, label, status);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failedResult(id, label, 0, `request failed: ${message}`, classifyTransportFailure("web"));
  }
}

async function checkAppBoundaryResource(baseUrl: URL, resource: string): Promise<DiagnosticResult> {
  const id = `app:api/${resource}`;
  const label = `/api/${resource} (Directus via app boundary)`;
  const path = `/api/${resource}`;
  let payload: unknown = null;
  let status = 0;
  try {
    const response = await fetchText(baseUrl, path);
    status = response.status;
    try {
      payload = JSON.parse(response.body);
    } catch {
      payload = null;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failedResult(id, label, 0, `request failed: ${message}`, classifyTransportFailure("app-api"));
  }

  if (status !== 200) {
    const errorCode = errorCodeOf(payload);
    const detail =
      errorCode === "UPSTREAM_UNAVAILABLE"
        ? `HTTP 503 UPSTREAM_UNAVAILABLE: the web app reached Directus and Directus failed`
        : `expected HTTP 200, got ${status}`;
    return failedResult(id, label, status, detail, classifyAppApiStatus(status, errorCode));
  }

  const payloadClass = classifyAppApiPayload(payload, { requireNonEmpty: REQUIRED_APP_BOUNDARY_RESOURCES.has(resource) });
  if (payloadClass !== null) {
    const detail =
      payloadClass === "web-error"
        ? "HTTP 200 but the response is not a JSON object with a data array"
        : "foundational resource returned an empty data array";
    return failedResult(id, label, status, detail, payloadClass);
  }
  return okResult(id, label, status);
}

async function checkDirectusPing(): Promise<DiagnosticResult> {
  const id = "directus:ping";
  const label = "Directus /server/ping (direct reachability)";
  const raw = process.env.DIRECTUS_URL;
  if (!raw) {
    return skippedResult(id, label, "DIRECTUS_URL not set; direct ping skipped (app-boundary checks still ran)");
  }
  let directusUrl: URL;
  try {
    directusUrl = new URL(raw);
  } catch {
    return failedResult(id, label, 0, `DIRECTUS_URL is not a valid URL: "${raw}"`, "directus-upstream");
  }
  let status = 0;
  try {
    const response = await fetch(new URL("/server/ping", directusUrl), {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    status = response.status;
    const body = await response.text();
    if (status === 200 && body.trim() === "pong") {
      return okResult(id, label, status);
    }
    const failureClass = classifyDirectusPing(status);
    return failedResult(
      id,
      label,
      status,
      status === 200 ? `unexpected ping body: "${body.trim()}"` : `expected HTTP 200, got ${status}`,
      failureClass ?? "directus-upstream",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failedResult(id, label, 0, `request failed: ${message}`, classifyTransportFailure("directus"));
  }
}

function printResult(result: DiagnosticResult): void {
  const marker = result.ok ? (result.skipped ? "SKIP" : "PASS") : "FAIL";
  const status = result.status > 0 ? ` (${result.status})` : "";
  const line = `${marker} ${result.id}${status} - ${result.label}`;
  if (result.ok) {
    console.log(line + (result.detail ? `\n     ${result.detail}` : ""));
  } else {
    console.error(line);
    console.error(`     - ${result.detail}`);
  }
}

async function main(): Promise<void> {
  const baseUrl = resolveBaseUrl();
  console.log(`Production health diagnostics for ${baseUrl.origin} (read-only, anonymous GET only, no credentials)`);

  const results: DiagnosticResult[] = [];
  results.push(await checkHomePage(baseUrl));
  results.push(await checkApiHealth(baseUrl));
  for (const resource of APP_BOUNDARY_RESOURCES) {
    results.push(await checkAppBoundaryResource(baseUrl, resource));
  }
  results.push(await checkDirectusPing());

  for (const result of results) {
    printResult(result);
  }

  const verdict = buildVerdict(results);
  const failed = results.filter((result) => !result.ok && !result.skipped).length;
  const skipped = results.filter((result) => result.skipped).length;
  const passed = results.length - failed - skipped;
  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log(`VERDICT: ${verdict} — ${VERDICT_SUMMARY[verdict]}`);
  process.exitCode = VERDICT_EXIT_CODES[verdict];
}

main().catch((error: unknown) => {
  console.error(`Diagnostics aborted: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
