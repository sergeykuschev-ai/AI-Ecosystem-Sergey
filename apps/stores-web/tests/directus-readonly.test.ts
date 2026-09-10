import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

const RUNTIME_SOURCE_DIRS = ["lib", "app", "components", "services"];

const NON_GET_METHOD_PATTERN = /method\s*:\s*["'](?:POST|PUT|PATCH|DELETE)["']/;

const DIRECTUS_MUTATION_PATTERN =
  /\b(?:create|update|delete)(?:Item|Items|Singleton|Users|Files|Folders)\b/;

function listSourceFiles(dir: string, accumulated: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      listSourceFiles(fullPath, accumulated);
    } else if (/\.(?:ts|tsx|js|mjs)$/.test(entry)) {
      accumulated.push(fullPath);
    }
  }
  return accumulated;
}

const runtimeFiles = RUNTIME_SOURCE_DIRS.flatMap((dir) => listSourceFiles(join(projectRoot, dir)));

function displayPath(filePath: string): string {
  return relative(projectRoot, filePath);
}

describe("runtime source never mutates Directus schema or data", () => {
  test("Directus data access goes through lib/directus/client.ts", () => {
    const directusDir = join(projectRoot, "lib", "directus");
    const dataModules = listSourceFiles(directusDir).filter(
      (file) => file !== join(directusDir, "client.ts"),
    );
    assert.ok(dataModules.length > 0, "expected Directus data modules");
    for (const file of dataModules) {
      const source = readFileSync(file, "utf8");
      assert.ok(
        !source.includes("fetch("),
        `${displayPath(file)} must not call fetch directly; use lib/directus/client.ts`,
      );
    }
  });

  test("Directus client performs read-only GET requests", () => {
    const clientSource = readFileSync(join(projectRoot, "lib", "directus", "client.ts"), "utf8");
    assert.ok(!NON_GET_METHOD_PATTERN.test(clientSource), "Directus client must not use non-GET methods");
    assert.ok(!DIRECTUS_MUTATION_PATTERN.test(clientSource), "Directus client must not call mutation helpers");
    assert.ok(clientSource.includes("readDirectusItems"), "client must expose readDirectusItems");
    assert.ok(clientSource.includes("readDirectusSingleton"), "client must expose readDirectusSingleton");
  });

  test("no runtime file that references Directus performs writes", () => {
    const offenders: string[] = [];
    for (const file of runtimeFiles) {
      const source = readFileSync(file, "utf8");
      if (!/directus/i.test(source)) continue;
      if (NON_GET_METHOD_PATTERN.test(source) || DIRECTUS_MUTATION_PATTERN.test(source)) {
        offenders.push(displayPath(file));
      }
    }
    assert.deepEqual(offenders, [], "runtime source must not mutate Directus schema or data");
  });
});
