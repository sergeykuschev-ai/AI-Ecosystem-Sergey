import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { KEY_RECRAWL_PATHS } from "@/lib/seo/key-urls";
import { normalizeIndexNowUrls } from "@/services/indexnow";

describe("IndexNow key re-crawl URLs", () => {
  test("normalizes the approved paths without making a request", () => {
    const urls = normalizeIndexNowUrls(KEY_RECRAWL_PATHS, "https://stores-test.local");
    assert.deepEqual(urls, KEY_RECRAWL_PATHS.map((path) => new URL(path, "https://stores-test.local").href));
  });

  test("deduplicates URLs and rejects a different origin", () => {
    assert.deepEqual(
      normalizeIndexNowUrls(["/amper/", "/amper/"], "https://stores-test.local"),
      ["https://stores-test.local/amper/"],
    );
    assert.throws(
      () => normalizeIndexNowUrls(["https://example.com/amper/"], "https://stores-test.local"),
      /does not match the configured site origin/,
    );
  });
});
