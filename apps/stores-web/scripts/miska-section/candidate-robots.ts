/**
 * Deterministic robots.txt transform for the «Миска» static bundle candidate.
 *
 * The bundle's robots.txt is served by Caddy for the whole site. The narrow
 * image-crawlability fix adds `Allow: /api/assets/` to every user-agent group
 * that carries the blanket `Disallow: /api/`, and nothing else.
 */

export const API_ASSETS_ALLOW_LINE = "Allow: /api/assets/";

/**
 * Returns the updated robots.txt. Pure: same input, same output.
 * Throws when the expected structure is absent (refuses to guess) and is
 * idempotent-safe: an already-patched file is returned unchanged.
 */
export function allowApiAssetsInRobots(robotsTxt: string): string {
  if (robotsTxt.includes(API_ASSETS_ALLOW_LINE)) return robotsTxt;
  const lines = robotsTxt.split("\n");
  const out: string[] = [];
  let patchedGroups = 0;
  for (const line of lines) {
    if (/^Disallow:\s*\/api\/\s*$/i.test(line.trim())) {
      if (out.at(-1)?.trim() !== API_ASSETS_ALLOW_LINE) {
        out.push(API_ASSETS_ALLOW_LINE);
      }
      patchedGroups += 1;
    }
    out.push(line);
  }
  if (patchedGroups === 0) {
    throw new Error("robots.txt has no `Disallow: /api/` group to patch — refusing to guess");
  }
  return out.join("\n");
}

/**
 * Validates the invariants the candidate robots.txt must keep:
 * - /api/assets/ explicitly allowed;
 * - the blanket /api/ disallow (and the other private paths) still present;
 * - both sitemap directives intact.
 */
export function assertCandidateRobots(robotsTxt: string): void {
  if (!robotsTxt.includes(API_ASSETS_ALLOW_LINE)) {
    throw new Error("candidate robots.txt is missing `Allow: /api/assets/`");
  }
  for (const required of ["Disallow: /api/", "Disallow: /admin/", "Disallow: /preview/", "Disallow: /directus/"]) {
    if (!robotsTxt.includes(required)) throw new Error(`candidate robots.txt lost \`${required}\``);
  }
  for (const sitemap of ["Sitemap: https://amurskmarket.ru/sitemap.xml", "Sitemap: https://amurskmarket.ru/sitemap-miska-pilot.xml"]) {
    if (!robotsTxt.includes(sitemap)) throw new Error(`candidate robots.txt lost \`${sitemap}\``);
  }
}
