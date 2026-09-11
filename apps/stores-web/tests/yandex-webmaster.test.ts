import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  getRecrawlQuotaRemainder,
  queriesToCsv,
  YandexWebmasterClient,
  YandexWebmasterError,
} from "@/services/yandex-webmaster";

function response(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("Yandex Webmaster client", () => {
  test("discovers the user and exact verified host without exposing the token", async () => {
    const calls: Array<{ url: string; authorization: string | null }> = [];
    const mockFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, authorization: new Headers(init?.headers).get("authorization") });
      if (url.endsWith("/user")) return response({ user_id: "42" });
      return response({ hosts: [
        { host_id: "https:other", ascii_host_url: "https://other.example", verification_state: "VERIFIED" },
        { host_id: "https:amurskmarket.ru:443", ascii_host_url: "https://amurskmarket.ru", verified: true },
      ] });
    };
    const client = new YandexWebmasterClient("secret-value", mockFetch);
    const context = await client.resolveContext();
    assert.equal(context.userId, "42");
    assert.equal(context.hostId, "https:amurskmarket.ru:443");
    assert.equal(calls.length, 2);
    assert.ok(calls.every((call) => call.authorization === "OAuth secret-value"));
    assert.ok(calls.every((call) => !call.url.includes("secret-value")));
  });

  test("loads status sections including quota and queue", async () => {
    const requested: string[] = [];
    const mockFetch: typeof fetch = async (input) => {
      requested.push(String(input));
      return response({ ok: true });
    };
    const client = new YandexWebmasterClient("token", mockFetch);
    const result = await client.getStatus({ userId: "1", hostId: "host", host: { verified: true } });
    assert.deepEqual(Object.keys(result), ["host", "summary", "diagnostics", "sitemaps", "recrawl"]);
    assert.equal(requested.length, 5);
    assert.ok(requested.some((url) => url.endsWith("/recrawl/quota")));
    assert.ok(requested.some((url) => url.endsWith("/recrawl/queue")));
  });

  test("normalizes popular query metrics and creates safe CSV", async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = new URL(String(input));
      assert.equal(url.searchParams.get("date_from"), "2026-08-01");
      assert.deepEqual(url.searchParams.getAll("query_indicator"), [
        "TOTAL_SHOWS", "TOTAL_CLICKS", "AVG_SHOW_POSITION", "AVG_CLICK_POSITION",
      ]);
      return response({ queries: [{
        query_text: "болты, гайки",
        indicators: { TOTAL_SHOWS: 100, TOTAL_CLICKS: 5, AVG_SHOW_POSITION: 3.2 },
      }] });
    };
    const client = new YandexWebmasterClient("token", mockFetch);
    const rows = await client.getQueries({ userId: "1", hostId: "host", host: {} }, "2026-08-01", "2026-08-31");
    assert.deepEqual(rows, [{ query: "болты, гайки", impressions: 100, clicks: 5, ctr: 0.05, position: 3.2 }]);
    assert.match(queriesToCsv(rows), /^query,impressions,clicks,ctr,position\n"болты, гайки",100,5,0.05,3.2$/);
  });

  test("submits only a same-origin URL with the documented payload", async () => {
    let body = "";
    const mockFetch: typeof fetch = async (_input, init) => {
      assert.equal(init?.method, "POST");
      body = String(init?.body);
      return response({ task_id: "task" }, 202);
    };
    const client = new YandexWebmasterClient("token", mockFetch);
    const context = { userId: "1", hostId: "host", host: {} };
    await client.submitRecrawl(context, "/amper/");
    assert.deepEqual(JSON.parse(body), { url: "https://amurskmarket.ru/amper/" });
    await assert.rejects(() => client.submitRecrawl(context, "https://example.com/"), /must belong/);
  });

  test("reads the re-crawl quota remainder without guessing when absent", () => {
    assert.equal(getRecrawlQuotaRemainder({ quota_remainder: 7 }), 7);
    assert.equal(getRecrawlQuotaRemainder({ remainder: 3 }), 3);
    assert.equal(getRecrawlQuotaRemainder({ daily_quota: 100 }), null);
  });

  for (const [status, code] of [[401, "AUTHENTICATION_FAILED"], [403, "ACCESS_DENIED"], [404, "RESOURCE_NOT_FOUND"], [409, "ALREADY_QUEUED"], [429, "RATE_LIMITED"]] as const) {
    test(`maps HTTP ${status} to a safe operational error`, async () => {
      const client = new YandexWebmasterClient("do-not-print", async () => response({}, status, { "retry-after": "12" }));
      await assert.rejects(
        () => client.resolveContext(),
        (error: unknown) => error instanceof YandexWebmasterError
          && error.code === code
          && error.retryAfterSeconds === 12
          && !error.message.includes("do-not-print"),
      );
    });
  }
});
