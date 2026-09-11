import { KEY_RECRAWL_PATHS } from "@/lib/seo/key-urls";
import {
  getRecrawlQuotaRemainder,
  queriesToCsv,
  YandexWebmasterClient,
  YandexWebmasterError,
  YANDEX_WEBMASTER_SITE_URL,
} from "@/services/yandex-webmaster";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function isoDate(daysAgo: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!command || !["status", "queries", "recrawl"].includes(command)) {
    throw new Error("Usage: yandex-webmaster <status|queries|recrawl> [--format json|csv] [--submit]");
  }
  const urls = KEY_RECRAWL_PATHS.map((path) => new URL(path, YANDEX_WEBMASTER_SITE_URL).href);
  if (command === "recrawl" && !process.argv.includes("--submit")) {
    console.log(JSON.stringify({ dryRun: true, submitted: 0, urls }, null, 2));
    return;
  }
  if (command === "recrawl" && process.env.CI) {
    throw new Error("Re-crawl submission is disabled when CI is set");
  }
  const client = YandexWebmasterClient.fromEnvironment();
  const context = await client.resolveContext();

  if (command === "status") {
    console.log(JSON.stringify(await client.getStatus(context), null, 2));
    return;
  }
  if (command === "queries") {
    const rows = await client.getQueries(
      context,
      argument("--from") ?? isoDate(30),
      argument("--to") ?? isoDate(0),
      Number(argument("--limit") ?? 100),
    );
    console.log(argument("--format") === "csv" ? queriesToCsv(rows) : JSON.stringify(rows, null, 2));
    return;
  }

  const quota = await client.getRecrawlQuota(context);
  const quotaRemainder = getRecrawlQuotaRemainder(quota);
  if (quotaRemainder !== null && quotaRemainder < urls.length) {
    throw new Error(`Re-crawl quota remainder ${quotaRemainder} is below the required ${urls.length}`);
  }
  const results = [];
  for (const url of urls) results.push({ url, result: await client.submitRecrawl(context, url) });
  console.log(JSON.stringify({ dryRun: false, quota, submitted: results.length, results }, null, 2));
}

main().catch((error: unknown) => {
  const safe = error instanceof YandexWebmasterError
    ? { error: error.code, status: error.status, message: error.message, retryAfterSeconds: error.retryAfterSeconds }
    : { error: "COMMAND_FAILED", message: error instanceof Error ? error.message : "Unknown error" };
  console.error(JSON.stringify(safe));
  process.exitCode = 1;
});
