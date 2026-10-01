export const SITE_NAME = "VOZDOOH";

/**
 * Absolute base URL for canonical links, sitemap and structured data.
 * Set NEXT_PUBLIC_SITE_URL in production. The localhost fallback is only
 * valid for local development and CI checks.
 */
export function getSiteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

export function absoluteUrl(path: string): string {
  return `${getSiteUrl()}${path}`;
}
