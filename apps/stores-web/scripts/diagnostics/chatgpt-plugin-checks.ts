/**
 * Pure classification logic for the ChatGPT plugin tunnel org-context
 * diagnostics.
 *
 * Kept free of any I/O so the decision rules can be unit-tested without
 * network access. The CLI in chatgpt-plugin-org-context.ts only fetches
 * data and delegates every failure/success decision to these functions.
 */

/**
 * Case-insensitive marker of the incident error
 * "UNAUTHORIZED: this tunnel requires an active organization context.
 * Configure the organization ID or send the OpenAI-Organization header."
 * emitted by the layer that terminates the tunnel request.
 */
export const ORG_CONTEXT_ERROR_MARKER = "requires an active organization context";

/**
 * Read-only discovery documents probed to characterize the plugin endpoint.
 * Tool/action endpoints (for example list_connections) are intentionally not
 * probed: diagnostics never invoke plugin actions.
 */
export const PLUGIN_DISCOVERY_PATHS = [
  "/.well-known/ai-plugin.json",
  "/.well-known/apps.json",
  "/openapi.json",
] as const;

export type PluginProbeFailureClass =
  | "unreachable"
  | "org-context-required"
  | "auth-other"
  | "endpoint-error";

export type PluginProbeVerdict =
  | "REACHABLE"
  | "UNREACHABLE"
  | "ORG_CONTEXT_REQUIRED"
  | "AUTH_ERROR_OTHER"
  | "ENDPOINT_ERROR";

export interface PluginProbeResult {
  id: string;
  label: string;
  ok: boolean;
  skipped?: boolean;
  status: number;
  detail: string;
  failureClass: PluginProbeFailureClass | null;
}

export const PLUGIN_VERDICT_EXIT_CODES: Record<PluginProbeVerdict, number> = {
  REACHABLE: 0,
  UNREACHABLE: 1,
  ORG_CONTEXT_REQUIRED: 2,
  AUTH_ERROR_OTHER: 3,
  ENDPOINT_ERROR: 4,
};

export const PLUGIN_VERDICT_SUMMARY: Record<PluginProbeVerdict, string> = {
  REACHABLE:
    "Plugin endpoint answers anonymous GET discovery requests without the org-context guard. The reported UNAUTHORIZED error is not reproducible on the discovery path; inspect tool-call auth and the ChatGPT-side org/workspace binding.",
  UNREACHABLE:
    "The plugin tunnel endpoint is not reachable at transport level (DNS, TLS, timeout, or the tunnel is not connected). The tunnel process on the host is the first suspect, not org context.",
  ORG_CONTEXT_REQUIRED:
    "The endpoint answers anonymous GET requests with the exact org-context UNAUTHORIZED error from the incident. The org guard is enforced before any tool runs; the request lacks the organization context the tunnel/app requires. Verify org/workspace/tunnel binding and the plugin's configured organization ID.",
  AUTH_ERROR_OTHER:
    "The endpoint answers anonymous GET requests with a 401/403 that does not carry the org-context marker. Authentication is enforced, but by a different rule; inspect the WWW-Authenticate header and plugin auth configuration.",
  ENDPOINT_ERROR:
    "The endpoint is reachable but answers with an unexpected HTTP status on discovery paths; inspect the plugin service health and logs.",
};

export function probeOk(id: string, label: string, status: number): PluginProbeResult {
  return { id, label, ok: true, status, detail: "", failureClass: null };
}

export function probeSkipped(id: string, label: string, detail: string): PluginProbeResult {
  return { id, label, ok: true, skipped: true, status: 0, detail, failureClass: null };
}

export function probeFailed(
  id: string,
  label: string,
  status: number,
  detail: string,
  failureClass: PluginProbeFailureClass,
): PluginProbeResult {
  return { id, label, ok: false, status, detail, failureClass };
}

/** True when a response body carries the org-context UNAUTHORIZED marker. */
export function bodyRequiresOrgContext(body: string): boolean {
  return body.toLowerCase().includes(ORG_CONTEXT_ERROR_MARKER);
}

/**
 * Classify a single probe response. HTTP 0 means the request never got an
 * answer (transport failure). 401/403 bodies carrying the incident marker are
 * the reproducible signal for the org-context guard; other 401/403 responses
 * are still auth failures but of a different kind. Any 2xx on a discovery
 * document is a pass; anything else is an endpoint error.
 */
export function classifyProbeStatus(status: number, body: string): PluginProbeFailureClass | null {
  if (status === 0) return "unreachable";
  if (status === 401 || status === 403) {
    return bodyRequiresOrgContext(body) ? "org-context-required" : "auth-other";
  }
  if (status >= 200 && status < 300) return null;
  return "endpoint-error";
}

/**
 * Worst failure class wins, ordered so that "nothing to diagnose against" is
 * never masked by a secondary signal from the same run.
 */
export function buildPluginVerdict(results: PluginProbeResult[]): PluginProbeVerdict {
  const classes = new Set(
    results.filter((result) => !result.ok && !result.skipped).map((result) => result.failureClass),
  );
  if (classes.has("unreachable")) return "UNREACHABLE";
  if (classes.has("org-context-required")) return "ORG_CONTEXT_REQUIRED";
  if (classes.has("auth-other")) return "AUTH_ERROR_OTHER";
  if (classes.has("endpoint-error")) return "ENDPOINT_ERROR";
  return "REACHABLE";
}
