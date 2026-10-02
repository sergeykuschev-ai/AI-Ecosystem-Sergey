import { SEO_RECRAWL_PATHS } from "@/lib/seo/recrawl-paths";
import { normalizeIndexNowUrls, submitChangedUrls } from "@/services/indexnow";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const shouldSubmit = process.argv.slice(2).includes("--submit");
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.SITE_URL;

  if (!configuredSiteUrl) {
    throw new Error("NEXT_PUBLIC_SITE_URL or SITE_URL must be configured");
  }

  const requestedUrl = argument("--url");
  const urls = normalizeIndexNowUrls(
    requestedUrl ? [requestedUrl] : SEO_RECRAWL_PATHS,
    configuredSiteUrl,
  );

  if (!shouldSubmit) {
    console.log("IndexNow dry run: no request was sent. URLs prepared for re-crawl:");
    for (const url of urls) console.log(url);
    return;
  }

  const result = await submitChangedUrls(urls);
  console.log(`IndexNow accepted ${result.submitted} URLs with HTTP ${result.status}.`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "IndexNow submission failed");
  process.exitCode = 1;
});
