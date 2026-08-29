interface DirectusListResponse<T> {
  data: T[];
}

const getDirectusUrl = () => process.env.DIRECTUS_URL?.replace(/\/$/, "");

export async function readDirectusItems<T>(
  collection: string,
  query = "filter[active][_eq]=true",
): Promise<T[] | null> {
  const contentSource = process.env.CONTENT_SOURCE ?? "mock";
  if (contentSource === "mock") return null;
  if (contentSource !== "directus") throw new Error(`Unsupported CONTENT_SOURCE: ${contentSource}`);

  const directusUrl = getDirectusUrl();
  if (!directusUrl) throw new Error("DIRECTUS_URL is required when CONTENT_SOURCE=directus");

  const token = process.env.DIRECTUS_SERVER_TOKEN;
  const response = await fetch(`${directusUrl}/items/${collection}?${query}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    next: { revalidate: 300, tags: [collection] },
  });

  if (!response.ok) {
    throw new Error(`Directus collection ${collection} returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as DirectusListResponse<T>;
  return payload.data;
}
