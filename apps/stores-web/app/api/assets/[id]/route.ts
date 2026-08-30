import { NextResponse } from "next/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: { code: "INVALID_ID", message: "Asset id must be a UUID" } }, { status: 400 });
  }

  const directusUrl = process.env.DIRECTUS_URL?.replace(/\/$/, "");
  if (!directusUrl) {
    return NextResponse.json({ error: { code: "CONFIGURATION", message: "DIRECTUS_URL is not set" } }, { status: 500 });
  }

  const token = process.env.DIRECTUS_SERVER_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: { code: "CONFIGURATION", message: "DIRECTUS_SERVER_TOKEN is not set" } },
      { status: 500 },
    );
  }

  const { searchParams } = new URL(request.url);
  const upstreamUrl = new URL(`/assets/${id}`, directusUrl);
  for (const [key, value] of searchParams) {
    upstreamUrl.searchParams.append(key, value);
  }

  try {
    const upstream = await fetch(upstreamUrl.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: { code: "UPSTREAM_ERROR", message: `Directus asset returned HTTP ${upstream.status}` } },
        { status: upstream.status },
      );
    }

    const headers = new Headers();
    const contentType = upstream.headers.get("content-type");
    if (contentType) headers.set("Content-Type", contentType);
    const contentLength = upstream.headers.get("content-length");
    if (contentLength) headers.set("Content-Length", contentLength);
    headers.set("Cache-Control", "public, max-age=31536000, immutable");

    return new NextResponse(upstream.body, { status: 200, headers });
  } catch (error) {
    console.error("Asset proxy failed", { id, cause: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json(
      { error: { code: "UPSTREAM_UNAVAILABLE", message: "Asset is temporarily unavailable" } },
      { status: 503 },
    );
  }
}
