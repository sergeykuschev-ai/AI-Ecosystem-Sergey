interface DirectusListResponse<T> {
  data: T[];
}

interface DirectusSingleResponse<T> {
  data: T;
}

const getDirectusUrl = () => process.env.DIRECTUS_URL?.replace(/\/$/, "");

function buildQueryString(fields?: string[], extra = "filter[active][_eq]=true"): string {
  const params = new URLSearchParams();
  if (fields && fields.length > 0) {
    for (const field of fields) {
      params.append("fields[]", field);
    }
  }
  if (extra) {
    for (const [key, value] of new URLSearchParams(extra)) {
      params.append(key, value);
    }
  }
  return params.toString();
}

function resolveContentSource(): string | null {
  const contentSource = process.env.CONTENT_SOURCE;
  if (contentSource) return contentSource;
  if (process.env.NODE_ENV === "production") {
    throw new Error("CONTENT_SOURCE is required in production");
  }
  return null; // development/test default: mock fallback
}

export async function readDirectusSingleton<T>(
  collection: string,
  fields?: string[],
): Promise<T | null> {
  const contentSource = resolveContentSource();
  if (contentSource === null || contentSource === "mock") return null;
  if (contentSource !== "directus") throw new Error(`Unsupported CONTENT_SOURCE: ${contentSource}`);

  const directusUrl = getDirectusUrl();
  if (!directusUrl) throw new Error("DIRECTUS_URL is required when CONTENT_SOURCE=directus");

  const queryString = buildQueryString(fields, "");
  const token = process.env.DIRECTUS_SERVER_TOKEN;
  const response = await fetch(`${directusUrl}/items/${collection}?${queryString}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    next: { revalidate: 300, tags: [collection] },
  });

  if (!response.ok) {
    throw new Error(`Directus singleton ${collection} returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as DirectusSingleResponse<T>;
  return payload.data;
}

export async function readDirectusItems<T>(
  collection: string,
  fields?: string[],
  query = "filter[active][_eq]=true",
): Promise<T[] | null> {
  const contentSource = resolveContentSource();
  if (contentSource === null || contentSource === "mock") return null;
  if (contentSource !== "directus") throw new Error(`Unsupported CONTENT_SOURCE: ${contentSource}`);

  const directusUrl = getDirectusUrl();
  if (!directusUrl) throw new Error("DIRECTUS_URL is required when CONTENT_SOURCE=directus");

  const queryString = buildQueryString(fields, query);
  const token = process.env.DIRECTUS_SERVER_TOKEN;
  const response = await fetch(`${directusUrl}/items/${collection}?${queryString}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    next: { revalidate: 300, tags: [collection] },
  });

  if (!response.ok) {
    throw new Error(`Directus collection ${collection} returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as DirectusListResponse<T>;
  return payload.data;
}
