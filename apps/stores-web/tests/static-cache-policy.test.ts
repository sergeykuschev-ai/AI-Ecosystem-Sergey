import assert from "node:assert/strict";
import { describe, test } from "node:test";
import nextConfig from "../next.config";

interface HeaderRule {
  source: string;
  headers: { key: string; value: string }[];
}

const CACHEABLE_IMAGE_DIRS = ["/brands/:path*", "/actual/:path*"];

function headerRules(): HeaderRule[] {
  assert.equal(typeof nextConfig.headers, "function", "next.config.ts must export an async headers()");
  // The exported function is sync in practice but typed async; support both.
  return (nextConfig.headers as unknown as () => HeaderRule[] | Promise<HeaderRule[]>)() as HeaderRule[];
}

describe("static image cache policy", () => {
  test("non-fingerprinted public images are cached instead of revalidated per visit", async () => {
    const rules = await headerRules();
    for (const source of CACHEABLE_IMAGE_DIRS) {
      const rule = rules.find((candidate) => candidate.source === source);
      assert.ok(rule, `missing headers() rule for ${source}`);
      const cacheControl = rule.headers.find((header) => header.key.toLowerCase() === "cache-control");
      assert.ok(cacheControl, `${source} rule must set Cache-Control`);
      assert.match(cacheControl.value, /max-age=86400/, `${source} should be cached for a day`);
      assert.match(
        cacheControl.value,
        /stale-while-revalidate/,
        `${source} should refresh stale entries in the background`,
      );
    }
  });

  test("cache rules come after the security catch-all so their Cache-Control wins", async () => {
    const rules = await headerRules();
    const catchAllIndex = rules.findIndex((rule) => rule.source === "/(.*)");
    assert.notEqual(catchAllIndex, -1, "security catch-all rule must exist");
    for (const source of CACHEABLE_IMAGE_DIRS) {
      const index = rules.findIndex((rule) => rule.source === source);
      assert.notEqual(index, -1, `missing headers() rule for ${source}`);
      assert.ok(index > catchAllIndex, `${source} rule must be listed after /(.*)`);
    }
  });
});
