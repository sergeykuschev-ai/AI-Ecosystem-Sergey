import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { mockActualItems, mockBrands } from "@/lib/data/mock-data";
import {
  DEFAULT_OG_IMAGE_HEIGHT,
  DEFAULT_OG_IMAGE_PATH,
  DEFAULT_OG_IMAGE_WIDTH,
} from "@/lib/seo/metadata";

const PUBLIC_DIR = path.join(process.cwd(), "public");
const APP_DIR = path.join(process.cwd(), "app");
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

  test("referenced image URLs and payloads are unique", () => {
    const paths = localPublicPaths();
    assert.equal(new Set(paths).size, paths.length, "the same image URL is referenced more than once");

    const hashes = new Map<string, string>();
    for (const assetPath of paths) {
      const digest = createHash("sha256")
        .update(readFileSync(path.join(PUBLIC_DIR, assetPath)))
        .digest("hex");
      const duplicate = hashes.get(digest);
      assert.equal(duplicate, undefined, `${assetPath} duplicates the payload of ${duplicate}`);
      hashes.set(digest, assetPath);
    }
  });
});

describe("default Open Graph image asset", () => {
  const ogPath = path.join(APP_DIR, DEFAULT_OG_IMAGE_PATH.slice(1));

  test("exists at the stable metadata URL and stays within the weight budget", () => {
    assert.ok(existsSync(ogPath), `missing file for ${DEFAULT_OG_IMAGE_PATH}`);
    assert.ok(statSync(ogPath).size <= MAX_ASSET_BYTES, "default OG image exceeds the asset weight budget");
  });

  test("physical PNG dimensions match the dimensions declared in metadata", () => {
    const contents = readFileSync(ogPath);
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok(contents.subarray(0, 8).equals(pngSignature), "default OG image must be a PNG");
    assert.equal(contents.readUInt32BE(16), DEFAULT_OG_IMAGE_WIDTH);
    assert.equal(contents.readUInt32BE(20), DEFAULT_OG_IMAGE_HEIGHT);
  });
});
