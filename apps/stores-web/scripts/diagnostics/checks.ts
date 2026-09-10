/**
 * Pure classification logic for the production health diagnostics.
 *
 * Kept free of any I/O so the decision rules can be unit-tested without
 * network access. The CLI in production.ts only fetches data and delegates
 * every failure/success decision to these functions.
 */

/** Public app-boundary resources that proxy Directus content (mirror app/api/[resource]/route.ts). */
export const APP_BOUNDARY_RESOURCES = [
  "brands",
  "cities",
  "stores",
  "promotions",
  "categories",
  "vacancies",
] as const;

/**
 * Resources the site cannot render without; an empty list here means
 * degraded content. Optional collections may legitimately be empty and are
 * only checked for a valid response shape.
 */
export const REQUIRED_APP_BOUNDARY_RESOURCES: ReadonlySet<string> = new Set(["brands", "cities", "stores"]);

export type FailureClass =
  | "web-down"
  | "web-error"
  | "directus-upstream"
  | "content-degraded";

export type Verdict = "OK" | "WEB_DOWN" | "WEB_ERROR" | "DIRECTUS_UPSTREAM" | "CONTENT_DEGRADED";

export interface DiagnosticResult {
  id: string;
  label: string;
  ok: boolean;
  skipped?: boolean;
  status: number;
  detail: string;
  failureClass: FailureClass | null;
}

export const VERDICT_EXIT_CODES: Record<Verdict, number> = {
  OK: 0,
  WEB_DOWN: 1,
  WEB_ERROR: 2,
  DIRECTUS_UPSTREAM: 3,
  CONTENT_DEGRADED: 4,
};

export const VERDICT_SUMMARY: Record<Verdict, string> = {
  OK: "Web, public app boundary, and Directus content checks all passed.",
  WEB_DOWN:
    "The public site is unreachable (network, DNS, TLS, or full outage). This is a web-layer or infrastructure outage, not a content problem.",
  WEB_ERROR:
    "The site responds, but pages, /api/health, or the public app API fail. A recent web deploy is the prime suspect; verify with the smoke-check and roll back per docs/WEB_ONLY_DEPLOY.md if it started right after a deploy.",
  DIRECTUS_UPSTREAM:
    "The web app is healthy but reports Directus unavailable (HTTP 503 UPSTREAM_UNAVAILABLE through the app boundary) or the Directus ping failed. The cause is upstream of the web container (Directus, Postgres, or the private network), not the web deploy itself.",
  CONTENT_DEGRADED:
    "All services respond, but a foundational public API resource (brands, cities, stores) returns empty data. Directus content, activity flags, or read permissions are the suspect, not web availability.",
};

export function okResult(id: string, label: string, status: number): DiagnosticResult {
  return { id, label, ok: true, status, detail: "", failureClass: null };
}

export function skippedResult(id: string, label: string, detail: string): DiagnosticResult {
  return { id, label, ok: true, skipped: true, status: 0, detail, failureClass: null };
}

export function failedResult(
  id: string,
  label: string,
  status: number,
  detail: string,
  failureClass: FailureClass,
): DiagnosticResult {
  return { id, label, ok: false, status, detail, failureClass };
}

/**
 * A transport-level failure (status 0: DNS, TLS, timeout, connection reset).
 * Reaching the web origin failed, except for the Directus-only scope, where
 * the web origin may be fine and the private Directus URL is at fault.
 */
export function classifyTransportFailure(scope: "web" | "app-api" | "directus"): FailureClass {
  return scope === "directus" ? "directus-upstream" : "web-down";
}

/** Public page or /api/health responded but not with the expected 200/ok. */
export function classifyWebEndpoint(status: number): FailureClass {
  return status === 0 ? "web-down" : "web-error";
}

/**
 * Classify the app-boundary API response status. HTTP 503 with the
 * UPSTREAM_UNAVAILABLE error code is the explicit signal that the web
 * container reached Directus and Directus failed; any other non-200 is a
 * web-layer problem.
 */
export function classifyAppApiStatus(status: number, errorCode: string | null): FailureClass {
  if (status === 0) return "web-down";
  if (status === 503 && errorCode === "UPSTREAM_UNAVAILABLE") return "directus-upstream";
  return "web-error";
}

/**
 * HTTP 200 but a broken payload shape (no data array) is a web-layer
 * contract failure. An empty data array degrades content only for
 * foundational resources — the site cannot render without them; optional
 * collections such as promotions may legitimately be empty.
 */
export function classifyAppApiPayload(payload: unknown, options: { requireNonEmpty: boolean }): FailureClass | null {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return "web-error";
  if (data.length === 0 && options.requireNonEmpty) return "content-degraded";
  return null;
}

/** Directus /server/ping must answer 200 with "pong"; anything else is upstream trouble. */
export function classifyDirectusPing(status: number): FailureClass | null {
  if (status === 200) return null;
  return "directus-upstream";
}

/**
 * Worst failure class wins, ordered so that "the site is down" is never
 * masked by a secondary upstream signal from the same run.
 */
export function buildVerdict(results: DiagnosticResult[]): Verdict {
  const classes = new Set(
    results.filter((result) => !result.ok && !result.skipped).map((result) => result.failureClass),
  );
  if (classes.has("web-down")) return "WEB_DOWN";
  if (classes.has("web-error")) return "WEB_ERROR";
  if (classes.has("directus-upstream")) return "DIRECTUS_UPSTREAM";
  if (classes.has("content-degraded")) return "CONTENT_DEGRADED";
  return "OK";
}
