import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import {
  APP_BOUNDARY_RESOURCES,
  REQUIRED_APP_BOUNDARY_RESOURCES,
  VERDICT_EXIT_CODES,
  buildVerdict,
  classifyAppApiPayload,
  classifyAppApiStatus,
  classifyDirectusPing,
  classifyTransportFailure,
  classifyWebEndpoint,
  failedResult,
  okResult,
  skippedResult,
  type DiagnosticResult,
} from "../scripts/diagnostics/checks";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

describe("production diagnostics classification", () => {
  test("transport failure is web-down for web scopes and upstream for directus", () => {
    assert.equal(classifyTransportFailure("web"), "web-down");
    assert.equal(classifyTransportFailure("app-api"), "web-down");
    assert.equal(classifyTransportFailure("directus"), "directus-upstream");
  });

  test("non-200 on a public endpoint is a web error", () => {
    assert.equal(classifyWebEndpoint(500), "web-error");
    assert.equal(classifyWebEndpoint(404), "web-error");
  });

  test("503 UPSTREAM_UNAVAILABLE is distinguished from other app API failures", () => {
    assert.equal(classifyAppApiStatus(503, "UPSTREAM_UNAVAILABLE"), "directus-upstream");
    assert.equal(classifyAppApiStatus(503, null), "web-error");
    assert.equal(classifyAppApiStatus(500, null), "web-error");
    assert.equal(classifyAppApiStatus(404, "NOT_FOUND"), "web-error");
  });

  test("app API payload must be a data array; emptiness fails only required resources", () => {
    assert.equal(classifyAppApiPayload({ data: [{ id: "1" }] }, { requireNonEmpty: true }), null);
    assert.equal(classifyAppApiPayload({ data: [] }, { requireNonEmpty: true }), "content-degraded");
    assert.equal(classifyAppApiPayload({ data: [] }, { requireNonEmpty: false }), null);
    assert.equal(classifyAppApiPayload({}, { requireNonEmpty: false }), "web-error");
    assert.equal(classifyAppApiPayload(null, { requireNonEmpty: true }), "web-error");
  });

  test("required app boundary resources are the site's foundational content", () => {
    assert.deepEqual([...REQUIRED_APP_BOUNDARY_RESOURCES].sort(), ["brands", "cities", "stores"]);
    for (const resource of REQUIRED_APP_BOUNDARY_RESOURCES) {
      assert.ok(APP_BOUNDARY_RESOURCES.includes(resource as (typeof APP_BOUNDARY_RESOURCES)[number]));
    }
  });

  test("directus ping only passes on HTTP 200", () => {
    assert.equal(classifyDirectusPing(200), null);
    assert.equal(classifyDirectusPing(503), "directus-upstream");
    assert.equal(classifyDirectusPing(0), "directus-upstream");
  });

  test("verdict precedence: web-down beats web-error beats upstream beats degraded", () => {
    const upstream = failedResult("a", "a", 503, "x", "directus-upstream");
    const degraded = failedResult("b", "b", 200, "x", "content-degraded");
    const webError = failedResult("c", "c", 500, "x", "web-error");
    const webDown = failedResult("d", "d", 0, "x", "web-down");

    assert.equal(buildVerdict([okResult("ok", "ok", 200)]), "OK");
    assert.equal(buildVerdict([upstream, degraded]), "DIRECTUS_UPSTREAM");
    assert.equal(buildVerdict([webError, upstream]), "WEB_ERROR");
    assert.equal(buildVerdict([webDown, webError, upstream, degraded]), "WEB_DOWN");
  });

  test("skipped checks never affect the verdict", () => {
    const skipped = skippedResult("directus:ping", "ping", "DIRECTUS_URL not set");
    const degraded = failedResult("b", "b", 200, "x", "content-degraded");
    assert.equal(buildVerdict([skipped]), "OK");
    assert.equal(buildVerdict([skipped, degraded]), "CONTENT_DEGRADED");
  });

  test("every verdict has a distinct non-zero exit code except OK", () => {
    const codes = Object.values(VERDICT_EXIT_CODES);
    assert.equal(new Set(codes).size, codes.length);
    assert.equal(VERDICT_EXIT_CODES.OK, 0);
    for (const verdict of ["WEB_DOWN", "WEB_ERROR", "DIRECTUS_UPSTREAM", "CONTENT_DEGRADED"] as const) {
      assert.ok(VERDICT_EXIT_CODES[verdict] > 0, `${verdict} must exit non-zero`);
    }
  });

  test("app boundary resources mirror the public API route registry", () => {
    const routeSource = readFileSync(join(projectRoot, "app", "api", "[resource]", "route.ts"), "utf8");
    for (const resource of APP_BOUNDARY_RESOURCES) {
      assert.ok(routeSource.includes(`${resource}: `), `/api/${resource} must exist in the public API route`);
    }
  });

  test("results keep a stable serializable shape", () => {
    const results: DiagnosticResult[] = [
      okResult("id", "label", 200),
      failedResult("id2", "label2", 503, "detail", "directus-upstream"),
      skippedResult("id3", "label3", "why"),
    ];
    for (const result of results) {
      assert.equal(typeof result.id, "string");
      assert.equal(typeof result.ok, "boolean");
      assert.equal(typeof result.status, "number");
      assert.equal(typeof result.detail, "string");
    }
    assert.equal(results[0].failureClass, null);
    assert.equal(results[1].failureClass, "directus-upstream");
  });
});

describe("production diagnostics CLI stays read-only and secret-free", () => {
  const cliSource = readFileSync(join(projectRoot, "scripts", "diagnostics", "production.ts"), "utf8");

  test("only anonymous GET requests are issued", () => {
    assert.ok(!/method\s*:\s*["'](?:POST|PUT|PATCH|DELETE)["']/.test(cliSource), "diagnostics must not use non-GET methods");
    assert.ok(!/\b(?:create|update|delete)(?:Item|Items|Singleton|Users|Files|Folders)\b/.test(cliSource));
    assert.ok(cliSource.includes('method: "GET"'), "diagnostics must issue explicit GET requests");
  });

  test("no credentials or authorization headers are read or sent", () => {
    assert.ok(!/Authorization/i.test(cliSource), "diagnostics must not send authorization headers");
    assert.ok(!/DIRECTUS_(?:SERVER|ADMIN|STATIC)_TOKEN/.test(cliSource), "diagnostics must not read Directus tokens");
    assert.ok(!/process\.env\.[A-Z_]*(?:TOKEN|SECRET|PASSWORD|KEY)[A-Z_]*/.test(cliSource));
  });
});
