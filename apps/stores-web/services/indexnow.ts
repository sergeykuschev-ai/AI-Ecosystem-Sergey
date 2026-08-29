interface IndexNowSubmission {
  host: string;
  key: string;
  keyLocation?: string;
  urlList: string[];
}

export interface IndexNowResult {
  submitted: number;
  status: number;
}

export async function submitChangedUrls(urls: string[]): Promise<IndexNowResult> {
  const key = process.env.INDEXNOW_KEY;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

  if (!key || !siteUrl) {
    throw new Error("INDEXNOW_KEY and NEXT_PUBLIC_SITE_URL are required for IndexNow submission");
  }

  const origin = new URL(siteUrl);
  const urlList = [...new Set(urls)].map((url) => new URL(url, origin).href);
  if (!urlList.length) return { submitted: 0, status: 204 };

  const payload: IndexNowSubmission = {
    host: origin.host,
    key,
    keyLocation: new URL(`/${key}.txt`, origin).href,
    urlList,
  };

  const response = await fetch(process.env.INDEXNOW_ENDPOINT ?? "https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) throw new Error(`IndexNow returned HTTP ${response.status}`);
  return { submitted: urlList.length, status: response.status };
}
