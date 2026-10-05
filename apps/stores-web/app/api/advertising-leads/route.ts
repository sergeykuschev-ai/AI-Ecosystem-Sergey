import { NextResponse } from "next/server";
import {
  parseAdvertisingLead,
  sendAdvertisingLeadEmail,
  sendAdvertisingLeadToArthur,
} from "@/lib/advertising/lead";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 16 * 1024;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 5;
const attemptsByIp = new Map<string, number[]>();

function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (!forwarded) return null;
  const first = forwarded.split(",")[0]?.trim();
  return first || null;
}

function rateLimitAllows(ip: string | null, now = Date.now()): boolean {
  if (!ip) return true;
  const recent = (attemptsByIp.get(ip) ?? []).filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) {
    attemptsByIp.set(ip, recent);
    return false;
  }
  recent.push(now);
  attemptsByIp.set(ip, recent);
  if (attemptsByIp.size > 2_000) {
    for (const [key, timestamps] of attemptsByIp) {
      if (!timestamps.some((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS)) attemptsByIp.delete(key);
    }
  }
  return true;
}

function requestOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const siteOrigin = new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://amurskmarket.ru").origin;
  return origin === siteOrigin;
}

export async function POST(request: Request) {
  if (!requestOriginAllowed(request)) {
    return NextResponse.json({ error: { code: "FORBIDDEN" } }, { status: 403 });
  }

  if (!rateLimitAllows(clientIp(request))) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "Слишком много попыток. Попробуйте позже." } },
      { status: 429, headers: { "Retry-After": "600" } },
    );
  }

  const contentLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: { code: "BODY_TOO_LARGE" } }, { status: 413 });
  }

  let raw = "";
  try {
    raw = await request.text();
  } catch {
    return NextResponse.json({ error: { code: "INVALID_REQUEST" } }, { status: 400 });
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: { code: "BODY_TOO_LARGE" } }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: { code: "INVALID_JSON" } }, { status: 400 });
  }

  const parsed = parseAdvertisingLead(body);
  if (parsed.status === "spam") {
    return NextResponse.json({ ok: true }, { status: 202 });
  }
  if (parsed.status === "invalid") {
    return NextResponse.json(
      { error: { code: "INVALID_FORM", fields: parsed.fields } },
      { status: 422 },
    );
  }

  const { lead } = parsed;
  try {
    await sendAdvertisingLeadEmail(lead);
  } catch (error) {
    console.error("Advertising lead email failed", {
      leadId: lead.id,
      cause: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { error: { code: "DELIVERY_UNAVAILABLE", message: "Не удалось отправить заявку. Попробуйте ещё раз." } },
      { status: 503 },
    );
  }

  try {
    await sendAdvertisingLeadToArthur(lead);
  } catch (error) {
    console.error("Arthur advertising lead notification failed", {
      leadId: lead.id,
      cause: error instanceof Error ? error.message : "unknown",
    });
  }

  return NextResponse.json({ ok: true, id: lead.id }, { status: 201 });
}
