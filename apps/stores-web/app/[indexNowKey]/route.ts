export async function GET(
  _request: Request,
  context: { params: Promise<{ indexNowKey: string }> },
) {
  const configuredKey = process.env.INDEXNOW_KEY;
  const { indexNowKey } = await context.params;

  if (!configuredKey || indexNowKey !== `${configuredKey}.txt`) {
    return new Response(null, { status: 404 });
  }

  return new Response(configuredKey, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
