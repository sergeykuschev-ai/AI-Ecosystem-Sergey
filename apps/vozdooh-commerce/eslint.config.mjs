import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  { files: ["**/*.cjs"], rules: { "@typescript-eslint/no-require-imports": "off" }, linterOptions: { reportUnusedDisableDirectives: "off" } },
  globalIgnores([".next*/**", "out/**", "next-env.d.ts"]),
]);
