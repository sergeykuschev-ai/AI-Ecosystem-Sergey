import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ORG_CONTEXT_ERROR_MARKER,
  PLUGIN_VERDICT_EXIT_CODES,
  bodyRequiresOrgContext,
  buildPluginVerdict,
  classifyProbeStatus,
  probeFailed,
  probeOk,
} from "../scripts/diagnostics/chatgpt-plugin-checks";

const INCIDENT_BODY =
  "UNAUTHORIZED: this tunnel requires an active organization context. " +
  "Configure the organization ID or send the OpenAI-Organization header.";

describe("chatgpt plugin org-context diagnostics classification", () => {
  test("the incident marker matches the reported error text case-insensitively", () => {
    assert.ok(INCIDENT_BODY.toLowerCase().includes(ORG_CONTEXT_ERROR_MARKER));
    assert.equal(bodyRequiresOrgContext(INCIDENT_BODY), true);
    assert.equal(bodyRequiresOrgContext(INCIDENT_BODY.toUpperCase()), true);
    assert.equal(bodyRequiresOrgContext("UNAUTHORIZED: invalid token"), false);
    assert.equal(bodyRequiresOrgContext(""), false);
  });

  test("transport failure has status 0 and is classified as unreachable", () => {
    assert.equal(classifyProbeStatus(0, ""), "unreachable");
  });

  test("401/403 with the incident marker is classified as org-context-required", () => {
    assert.equal(classifyProbeStatus(401, INCIDENT_BODY), "org-context-required");
    assert.equal(classifyProbeStatus(403, INCIDENT_BODY), "org-context-required");
  });

  test("401/403 without the marker is a different auth failure", () => {
    assert.equal(classifyProbeStatus(401, '{"error":"invalid token"}'), "auth-other");
    assert.equal(classifyProbeStatus(403, "Forbidden"), "auth-other");
  });

  test("2xx discovery responses pass and other statuses are endpoint errors", () => {
    assert.equal(classifyProbeStatus(200, "{}"), null);
    assert.equal(classifyProbeStatus(404, "Not Found"), "endpoint-error");
    assert.equal(classifyProbeStatus(500, "Internal Server Error"), "endpoint-error");
  });

  test("verdict priority puts unreachable above the org-context signal", () => {
    const results = [
      probeFailed("plugin:/", "root", 0, "timeout", "unreachable"),
      probeFailed("plugin:/openapi.json", "openapi", 401, INCIDENT_BODY, "org-context-required"),
      probeOk("plugin:/.well-known/apps.json", "apps", 200),
    ];
    assert.equal(buildPluginVerdict(results), "UNREACHABLE");
  });

  test("verdict reports org-context-required when the marker is reproducible", () => {
    const results = [
      probeFailed("plugin:/", "root", 401, INCIDENT_BODY, "org-context-required"),
      probeFailed("plugin:/openapi.json", "openapi", 401, INCIDENT_BODY, "org-context-required"),
    ];
    assert.equal(buildPluginVerdict(results), "ORG_CONTEXT_REQUIRED");
  });

  test("verdict reports other auth failure and endpoint error distinctly", () => {
    assert.equal(
      buildPluginVerdict([probeFailed("plugin:/", "root", 401, "nope", "auth-other")]),
      "AUTH_ERROR_OTHER",
    );
    assert.equal(
      buildPluginVerdict([probeFailed("plugin:/", "root", 500, "boom", "endpoint-error")]),
      "ENDPOINT_ERROR",
    );
  });

  test("all passing probes yield REACHABLE with exit code 0", () => {
    const results = [probeOk("plugin:/", "root", 200), probeOk("plugin:/openapi.json", "openapi", 200)];
    assert.equal(buildPluginVerdict(results), "REACHABLE");
    assert.equal(PLUGIN_VERDICT_EXIT_CODES.REACHABLE, 0);
    assert.equal(PLUGIN_VERDICT_EXIT_CODES.ORG_CONTEXT_REQUIRED, 2);
  });
});
