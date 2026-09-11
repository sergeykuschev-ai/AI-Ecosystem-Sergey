const API_BASE_URL = "https://api.webmaster.yandex.net/v4";
export const YANDEX_WEBMASTER_SITE_URL = "https://amurskmarket.ru";

type Fetch = typeof fetch;
type JsonRecord = Record<string, unknown>;

export interface WebmasterContext {
  userId: string;
  hostId: string;
  host: JsonRecord;
}

export interface QueryRow {
  query: string;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  position: number | null;
}

export class YandexWebmasterError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "YandexWebmasterError";
  }
}

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" ? (value as JsonRecord) : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function identifier(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return undefined;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function apiError(status: number, headers: Headers): YandexWebmasterError {
  const details: Record<number, [string, string]> = {
    401: ["AUTHENTICATION_FAILED", "Yandex Webmaster rejected the OAuth token"],
    403: ["ACCESS_DENIED", "The OAuth account cannot access this Webmaster resource"],
    404: ["RESOURCE_NOT_FOUND", "The requested Webmaster resource was not found"],
    409: ["ALREADY_QUEUED", "The URL is already present in the re-crawl queue"],
    429: ["RATE_LIMITED", "Yandex Webmaster rate limit or re-crawl quota was reached"],
  };
  const [code, message] = details[status] ?? ["API_ERROR", `Yandex Webmaster returned HTTP ${status}`];
  const retryAfter = Number(headers.get("retry-after"));
  return new YandexWebmasterError(message, status, code, Number.isFinite(retryAfter) ? retryAfter : undefined);
}

export class YandexWebmasterClient {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: Fetch = fetch,
    private readonly apiBaseUrl = API_BASE_URL,
  ) {
    if (!token.trim()) throw new Error("YANDEX_WEBMASTER_TOKEN is required");
  }

  static fromEnvironment(fetchImpl: Fetch = fetch): YandexWebmasterClient {
    const token = process.env.YANDEX_WEBMASTER_TOKEN;
    if (!token) throw new Error("YANDEX_WEBMASTER_TOKEN is required in the runtime environment");
    return new YandexWebmasterClient(token, fetchImpl);
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `OAuth ${this.token}`,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      signal: init.signal ?? AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw apiError(response.status, response.headers);
    if (response.status === 204) return null;
    return response.json();
  }

  async resolveContext(siteUrl = YANDEX_WEBMASTER_SITE_URL): Promise<WebmasterContext> {
    const user = record(await this.request("/user"));
    const userId = identifier(user.user_id);
    if (!userId) throw new Error("Yandex Webmaster /user response did not contain user_id");

    const hostsResponse = record(await this.request(`/user/${encodeURIComponent(userId)}/hosts`));
    const hosts = Array.isArray(hostsResponse.hosts) ? hostsResponse.hosts.map(record) : [];
    const expected = new URL(siteUrl).origin;
    const host = hosts.find((candidate) => {
      const candidateUrl = text(candidate.ascii_host_url) ?? text(candidate.unicode_host_url);
      const verified = candidate.verified === true || candidate.verification_state === "VERIFIED";
      if (!candidateUrl || !verified) return false;
      try {
        return new URL(candidateUrl).origin === expected;
      } catch {
        return false;
      }
    });
    const hostId = host && text(host.host_id);
    if (!host || !hostId) throw new Error(`No verified Yandex Webmaster host found for ${expected}`);
    return { userId, hostId, host };
  }

  private hostPath(context: WebmasterContext, suffix: string): string {
    return `/user/${encodeURIComponent(context.userId)}/hosts/${encodeURIComponent(context.hostId)}${suffix}`;
  }

  async getStatus(context: WebmasterContext): Promise<JsonRecord> {
    const endpoints = ["/summary", "/diagnostics", "/sitemaps", "/recrawl/quota", "/recrawl/queue"] as const;
    const [summary, diagnostics, sitemaps, recrawlQuota, recrawlQueue] = await Promise.all(
      endpoints.map((endpoint) => this.request(this.hostPath(context, endpoint))),
    );
    return {
      host: context.host,
      summary,
      diagnostics,
      sitemaps,
      recrawl: { quota: recrawlQuota, queue: recrawlQueue },
    };
  }

  async getQueries(context: WebmasterContext, dateFrom: string, dateTo: string, limit = 100): Promise<QueryRow[]> {
    const params = new URLSearchParams({
      date_from: dateFrom,
      date_to: dateTo,
      order_by: "TOTAL_SHOWS",
      limit: String(limit),
    });
    for (const indicator of ["TOTAL_SHOWS", "TOTAL_CLICKS", "AVG_SHOW_POSITION", "AVG_CLICK_POSITION"]) {
      params.append("query_indicator", indicator);
    }
    const payload = record(await this.request(this.hostPath(context, `/search-queries/popular?${params}`)));
    const queries = Array.isArray(payload.queries) ? payload.queries : [];
    return queries.map((item) => {
      const row = record(item);
      const indicators = record(row.indicators);
      const impressions = number(indicators.TOTAL_SHOWS);
      const clicks = number(indicators.TOTAL_CLICKS);
      return {
        query: text(row.query_text) ?? text(row.query) ?? "",
        impressions,
        clicks,
        ctr: impressions && clicks !== null ? clicks / impressions : null,
        position: number(indicators.AVG_SHOW_POSITION) ?? number(indicators.AVG_CLICK_POSITION),
      };
    });
  }

  async getRecrawlQuota(context: WebmasterContext): Promise<unknown> {
    return this.request(this.hostPath(context, "/recrawl/quota"));
  }

  async submitRecrawl(context: WebmasterContext, url: string): Promise<unknown> {
    const expectedOrigin = new URL(YANDEX_WEBMASTER_SITE_URL).origin;
    const target = new URL(url, expectedOrigin);
    if (target.origin !== expectedOrigin) throw new Error(`Re-crawl URL must belong to ${expectedOrigin}`);
    return this.request(this.hostPath(context, "/recrawl/queue"), {
      method: "POST",
      body: JSON.stringify({ url: target.href }),
    });
  }
}

export function queriesToCsv(rows: readonly QueryRow[]): string {
  const escape = (value: string | number | null) => {
    const raw = value === null ? "" : String(value);
    return /[",\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
  };
  return [
    "query,impressions,clicks,ctr,position",
    ...rows.map((row) => [row.query, row.impressions, row.clicks, row.ctr, row.position].map(escape).join(",")),
  ].join("\n");
}

export function getRecrawlQuotaRemainder(quota: unknown): number | null {
  const payload = record(quota);
  return number(payload.quota_remainder) ?? number(payload.remainder);
}
