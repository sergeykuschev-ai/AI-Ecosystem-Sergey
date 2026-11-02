/**
 * Read-only diagnostics for the custom ChatGPT plugin "Управление серверами"
 * (SSH server management) tunnel endpoint.
 *
 * Incident: calls from ChatGPT (for example list_connections) fail with
 * "UNAUTHORIZED: this tunnel requires an active organization context.
 * Configure the organization ID or send the OpenAI-Organization header."
 * while the tunnel process itself (stores-web1) reports as connected.
 *
 * This script answers one question: does the plugin endpoint enforce the
 * org-context guard for anonymous read-only discovery requests, and if so,
 * with which hints? It sends only anonymous GET requests to the plugin base
 * URL. It never sends an Authorization header, never sends an
 * OpenAI-Organization header (the guard must be observable without one),
 * never invokes plugin tools/actions (no list_connections, no POST), and
 * never reads or prints secrets. Header values and body excerpts are
 * truncated before printing.
 *
 * Usage:
 *   CHATGPT_PLUGIN_BASE_URL=https://<tunnel-or-plugin-origin> npm run diagnose:chatgpt-plugin
 *
 * Exit codes (see PLUGIN_VERDICT_EXIT_CODES):
 *   0 REACHABLE, 1 UNREACHABLE, 2 ORG_CONTEXT_REQUIRED, 3 AUTH_ERROR_OTHER,
 *   4 ENDPOINT_ERROR
 */

import {
  PLUGIN_DISCOVERY_PATHS,
  PLUGIN_VERDICT_EXIT_CODES,
  PLUGIN_VERDICT_SUMMARY,
  buildPluginVerdict,
  classifyProbeStatus,
  probeFailed,
  probeOk,
  type PluginProbeResult,
} from "./chatgpt-plugin-checks";

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_EXCERPT_LENGTH = 160;

function resolveBaseUrl(): URL {
  const raw = process.env.CHATGPT_PLUGIN_BASE_URL;
  if (!raw) {
    throw new Error(
      "CHATGPT_PLUGIN_BASE_URL is not set. " +
        "Point it at the plugin tunnel origin explicitly, for example " +
        "CHATGPT_PLUGIN_BASE_URL=https://<tunnel-origin> npm run diagnose:chatgpt-plugin",
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`CHATGPT_PLUGIN_BASE_URL is not a valid URL: "${raw}"`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`CHATGPT_PLUGIN_BASE_URL must use http or https: "${raw}"`);
  }
  return url;
}

function truncate(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > MAX_EXCERPT_LENGTH
    ? `${normalized.slice(0, MAX_EXCERPT_LENGTH)}…`
    : normalized;
}

interface HttpResponse {
  status: number;
  body: string;
  /** Truncated, diagnostics-relevant response headers only. */
  headers: Record<string, string>;
}

function collectRelevantHeaders(headers: Headers): Record<string, string> {
  const relevant: Record<string, string> = {};
  headers.forEach((value, name) => {
    if (name.toLowerCase() === "www-authenticate" || name.toLowerCase().includes("openai")) {
      relevant[name] = truncate(value);
    }
  });
  return relevant;
}

async function fetchText(baseUrl: URL, path: string): Promise<HttpResponse> {
  const response = await fetch(new URL(path, baseUrl), {
    method: "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { accept: "application/json,text/html,*/*" },
  });
  const body = await response.text();
  return { status: response.status, body, headers: collectRelevantHeaders(response.headers) };
}

function describeFailure(status: number, body: string, headers: Record<string, string>): string {
  const parts: string[] = [];
  const failureClass = classifyProbeStatus(status, body);
  if (failureClass === "org-context-required") {
    parts.push("response carries the org-context UNAUTHORIZED marker from the incident");
  } else if (status === 401 || status === 403) {
    parts.push(`expected anonymous access or the org-context marker, got HTTP ${status}`);
  } else {
    parts.push(`expected HTTP 2xx on a discovery document, got ${status}`);
  }
  const authenticate = headers["www-authenticate"];
  if (authenticate) {
    parts.push(`WWW-Authenticate: ${authenticate}`);
  }
  const excerpt = truncate(body);
  if (excerpt) {
    parts.push(`body excerpt: ${excerpt}`);
  }
  return parts.join("; ");
}

async function checkPath(baseUrl: URL, path: string): Promise<PluginProbeResult> {
  const id = `plugin:${path}`;
  const label = `GET ${path} (anonymous, read-only)`;
  try {
    const { status, body, headers } = await fetchText(baseUrl, path);
    const failureClass = classifyProbeStatus(status, body);
    if (failureClass !== null) {
      return probeFailed(id, label, status, describeFailure(status, body, headers), failureClass);
    }
    const detailParts: string[] = [];
    const authenticate = headers["www-authenticate"];
    if (authenticate) {
      detailParts.push(`WWW-Authenticate: ${authenticate}`);
    }
    return {
      ...probeOk(id, label, status),
      detail: detailParts.join("; "),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return probeFailed(id, label, 0, `request failed: ${message}`, "unreachable");
  }
}

function printResult(result: PluginProbeResult): void {
  const marker = result.ok ? "PASS" : "FAIL";
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
  console.log(
    `ChatGPT plugin tunnel diagnostics for ${baseUrl.origin} ` +
      "(read-only anonymous GET only; no credentials, no tool calls)",
  );

  const results: PluginProbeResult[] = [];
  results.push(await checkPath(baseUrl, "/"));
  for (const path of PLUGIN_DISCOVERY_PATHS) {
    results.push(await checkPath(baseUrl, path));
  }

  for (const result of results) {
    printResult(result);
  }

  const verdict = buildPluginVerdict(results);
  const failed = results.filter((result) => !result.ok).length;
  const passed = results.length - failed;
  console.log(`\n${passed} passed, ${failed} failed`);
  console.log(`VERDICT: ${verdict} — ${PLUGIN_VERDICT_SUMMARY[verdict]}`);
  process.exitCode = PLUGIN_VERDICT_EXIT_CODES[verdict];
}

main().catch((error: unknown) => {
  console.error(`Diagnostics aborted: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
