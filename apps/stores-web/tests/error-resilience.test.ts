import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { readDirectusItems, readDirectusSingleton } from "@/lib/directus/client";
import { createListingPageMetadata } from "@/lib/seo/metadata";
import { GET as readResource } from "@/app/api/[resource]/route";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

const TEST_TOKEN = "test-directus-token-that-must-never-leak";

interface EnvSnapshot {
  contentSource: string | undefined;
  directusUrl: string | undefined;
  directusToken: string | undefined;
}

function snapshotEnv(): EnvSnapshot {
  return {
    contentSource: process.env.CONTENT_SOURCE,
    directusUrl: process.env.DIRECTUS_URL,
    directusToken: process.env.DIRECTUS_SERVER_TOKEN,
  };
}

function restoreEnv(snapshot: EnvSnapshot) {
  restoreVariable("CONTENT_SOURCE", snapshot.contentSource);
  restoreVariable("DIRECTUS_URL", snapshot.directusUrl);
  restoreVariable("DIRECTUS_SERVER_TOKEN", snapshot.directusToken);
}

function restoreVariable(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function useDirectusEnv(testContext: { after: (fn: () => void) => void }) {
  const snapshot = snapshotEnv();
  process.env.CONTENT_SOURCE = "directus";
  process.env.DIRECTUS_URL = "https://directus-test.local";
  process.env.DIRECTUS_SERVER_TOKEN = TEST_TOKEN;
  testContext.after(() => restoreEnv(snapshot));
}

function stubFetch(
  testContext: { after: (fn: () => void) => void },
  implementation: typeof fetch,
) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = implementation;
  testContext.after(() => {
    globalThis.fetch = originalFetch;
  });
}

function failingFetch(status: number): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ errors: [{ message: "upstream boom" }] }), {
      status,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

describe("Directus content failures never fall back to mock content", () => {
  test("readDirectusItems rejects on upstream HTTP error and keeps secrets out of the message", async (t) => {
    useDirectusEnv(t);
    stubFetch(t, failingFetch(503));

    const failure = await readDirectusItems("brands", ["*"]).then(
      () => null,
      (error: unknown) => error,
    );
    assert.ok(failure instanceof Error, "expected readDirectusItems to reject");
    assert.match(failure.message, /brands/);
    assert.match(failure.message, /503/);
    assert.ok(!failure.message.includes(TEST_TOKEN), "error message must not leak the Directus token");
  });

  test("readDirectusSingleton rejects on upstream HTTP error", async (t) => {
    useDirectusEnv(t);
    stubFetch(t, failingFetch(500));

    await assert.rejects(() => readDirectusSingleton("bonus_programs", ["*"]), /bonus_programs/);
  });

  test("readDirectusItems rejects on network failure instead of serving mock data", async (t) => {
    useDirectusEnv(t);
    stubFetch(
      t,
      (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
    );

    await assert.rejects(() => readDirectusItems("stores", ["*"]));
  });

  test("mock fallback stays limited to explicit mock content source", async (t) => {
    const snapshot = snapshotEnv();
    t.after(() => restoreEnv(snapshot));
    process.env.CONTENT_SOURCE = "mock";
    stubFetch(t, async () => {
      throw new Error("fetch must not be called for mock content source");
    });

    assert.equal(await readDirectusItems("brands", ["*"]), null);
    assert.equal(await readDirectusSingleton("bonus_programs", ["*"]), null);
  });

  test("unsupported CONTENT_SOURCE is rejected", async (t) => {
    const snapshot = snapshotEnv();
    t.after(() => restoreEnv(snapshot));
    process.env.CONTENT_SOURCE = "legacy-cms";

    await assert.rejects(() => readDirectusItems("brands", ["*"]), /Unsupported CONTENT_SOURCE/);
  });
});

describe("public API route normalizes upstream failures", () => {
  test("unknown resource returns a stable 404 code", async () => {
    const response = await readResource(
      new Request("https://stores-test.local/api/unknown"),
      { params: Promise.resolve({ resource: "unknown" }) },
    );
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error.code, "NOT_FOUND");
  });

  test("Directus outage returns 503 UPSTREAM_UNAVAILABLE without leaking secrets", async (t) => {
    useDirectusEnv(t);
    stubFetch(t, failingFetch(502));

    const response = await readResource(new Request("https://stores-test.local/api/brands"), {
      params: Promise.resolve({ resource: "brands" }),
    });
    assert.equal(response.status, 503);
    const rawBody = await response.text();
    assert.ok(!rawBody.includes(TEST_TOKEN), "API error body must not leak the Directus token");
    const body = JSON.parse(rawBody) as { error: { code: string; message: string } };
    assert.equal(body.error.code, "UPSTREAM_UNAVAILABLE");
  });
});

describe("error boundaries fail clearly without leaking internals", () => {
  const errorBoundaryFiles = ["app/error.tsx", "app/global-error.tsx"];

  test("root error boundaries exist as client components with a reset action", () => {
    for (const file of errorBoundaryFiles) {
      const source = readFileSync(join(projectRoot, file), "utf8");
      assert.ok(source.includes('"use client"'), `${file} must be a Client Component`);
      assert.ok(/reset\s*[:)]/.test(source) || source.includes("reset()"), `${file} must expose the Next.js reset action`);
      assert.ok(source.includes("error.digest") || source.includes("digest"), `${file} should log the error digest`);
    }
  });

  test("error boundaries never render the raw error message", () => {
    for (const file of errorBoundaryFiles) {
      const source = readFileSync(join(projectRoot, file), "utf8");
      assert.ok(!source.includes("error.message"), `${file} must not render error.message`);
    }
  });

  test("root not-found page offers recovery navigation", () => {
    const source = readFileSync(join(projectRoot, "app", "not-found.tsx"), "utf8");
    assert.ok(source.includes('href="/"'), "not-found must link to the home page");
    assert.ok(source.includes("stores"), "not-found must link to the store list");
  });

  test("404 and error UI explicitly prevent indexing without publishing a canonical", () => {
    const notFoundSource = readFileSync(join(projectRoot, "app", "not-found.tsx"), "utf8");
    assert.match(notFoundSource, /robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/);
    assert.ok(!notFoundSource.includes("canonical"), "not-found must not publish a canonical URL");

    for (const file of errorBoundaryFiles) {
      const source = readFileSync(join(projectRoot, file), "utf8");
      assert.ok(source.includes('name="robots"'), `${file} must emit robots metadata`);
      assert.ok(source.includes("noindex, nofollow"), `${file} must prevent indexing`);
      assert.ok(!source.includes("canonical"), `${file} must not publish a canonical URL`);
    }
  });

  test("unknown city and store slugs terminate in generateMetadata with notFound", () => {
    for (const file of ["app/stores/[city]/page.tsx", "app/stores/[city]/[store]/page.tsx"]) {
      const source = readFileSync(join(projectRoot, file), "utf8");
      assert.match(source, /generateMetadata[\s\S]*if \(!(?:city|data)\) notFound\(\)/);
    }
  });

  test("dynamic entity checks complete before the response starts streaming", () => {
    assert.throws(
      () => readFileSync(join(projectRoot, "app", "loading.tsx"), "utf8"),
      /ENOENT/,
      "a root loading boundary would lock missing dynamic routes to HTTP 200",
    );
  });

  test("empty editorial listings are rendered as noindex soft-empty states", () => {
    for (const file of ["app/akcii/page.tsx", "app/vakansii/page.tsx", "app/faq/page.tsx"]) {
      const source = readFileSync(join(projectRoot, file), "utf8");
      assert.ok(source.includes("createListingPageMetadata"), `${file} must set listing metadata`);
      assert.ok(source.includes("<EmptyState"), `${file} must explain the empty state`);
    }
  });

  test("listing metadata only prevents indexing when the list is empty", () => {
    const input = { title: "List", description: "List content", path: "/list/" };
    const empty = createListingPageMetadata(input, 0);
    const populated = createListingPageMetadata(input, 1);

    assert.deepEqual(empty.robots, { index: false, follow: false });
    assert.deepEqual(populated.robots, { index: true, follow: true });
  });
});
