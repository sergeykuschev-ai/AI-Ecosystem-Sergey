import { spawnSync } from "node:child_process";

const SEO_REGRESSION_TESTS = [
  "tests/accessibility.test.ts",
  "tests/json-ld.test.ts",
  "tests/link-integrity.test.ts",
  "tests/local-seo.test.ts",
  "tests/public-assets.test.ts",
  "tests/seo-routes.test.ts",
] as const;

console.log("Stores Web local SEO regression gate");
console.log(`Reusing ${SEO_REGRESSION_TESTS.length} deterministic test suites (no network requests).\n`);

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", ...SEO_REGRESSION_TESTS],
  {
    cwd: process.cwd(),
    env: { ...process.env, SITE_URL: process.env.SITE_URL ?? "https://stores-test.local" },
    stdio: "inherit",
  },
);

if (result.error) {
  console.error(`\nSEO REGRESSION VERDICT: ERROR (${result.error.message})`);
  process.exitCode = 1;
} else if (result.status !== 0) {
  console.error(`\nSEO REGRESSION VERDICT: FAIL (test runner exited with ${result.status ?? "no status"})`);
  process.exitCode = result.status ?? 1;
} else {
  console.log("\nSEO REGRESSION VERDICT: PASS");
}
