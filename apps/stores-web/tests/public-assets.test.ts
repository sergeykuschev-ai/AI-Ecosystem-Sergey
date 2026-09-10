import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { mockActualItems, mockBrands } from "@/lib/data/mock-data";

const PUBLIC_DIR = path.join(process.cwd(), "public");
const MAX_ASSET_BYTES = 200_000;
const EFFICIENT_EXTENSIONS = new Set([".webp", ".avif", ".svg"]);

function localPublicPaths(): string[] {
  const paths = mockBrands.map((brand) => brand.logo).filter((logo): logo is string => Boolean(logo));
  for (const item of mockActualItems) {
    if (item.image?.startsWith("/")) paths.push(item.image);
  }
  return paths;
}

describe("public image assets referenced by mock content", () => {
  test("every referenced local image exists in public/", () => {
    const paths = localPublicPaths();
    assert.ok(paths.length > 0, "expected mock content to reference local images");
    for (const assetPath of paths) {
      assert.ok(existsSync(path.join(PUBLIC_DIR, assetPath)), `missing file for ${assetPath}`);
    }
  });

  test("referenced raster images use an efficient format", () => {
    for (const assetPath of localPublicPaths()) {
      const extension = path.extname(assetPath).toLowerCase();
      assert.ok(
        EFFICIENT_EXTENSIONS.has(extension),
        `${assetPath} uses ${extension}; use WebP/AVIF for photographic assets`,
      );
    }
  });

  test("no referenced image exceeds the asset weight budget", () => {
    for (const assetPath of localPublicPaths()) {
      const bytes = statSync(path.join(PUBLIC_DIR, assetPath)).size;
      assert.ok(
        bytes <= MAX_ASSET_BYTES,
        `${assetPath} is ${bytes} bytes; keep local assets under ${MAX_ASSET_BYTES} bytes`,
      );
    }
  });
});
