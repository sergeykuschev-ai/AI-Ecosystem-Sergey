/**
 * Low-level Directus API client for schema and seed scripts.
 * Uses DIRECTUS_ADMIN_TOKEN for write access. Credentials never leave Node.js.
 */

export interface DirectusClientOptions {
  directusUrl: string;
  token: string;
  dryRun?: boolean;
}

export class DirectusAdminClient {
  private readonly baseUrl: string;
  private readonly token: string;
  readonly dryRun: boolean;

  constructor(options: DirectusClientOptions) {
    this.baseUrl = options.directusUrl.replace(/\/$/, "");
    this.token = options.token;
    this.dryRun = options.dryRun ?? false;
  }

  private headers(body?: unknown): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
    };
    // Only set JSON content type for non-FormData bodies. FormData needs the
    // boundary generated automatically by fetch.
    if (body && !(body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }
    return headers;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    if (this.dryRun && method !== "GET") {
      console.log(`[DRY RUN] ${method} ${url}`);
      return undefined as T;
    }

    const response = await fetch(url, {
      method,
      headers: this.headers(body),
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Directus API ${method} ${path} failed: ${response.status} ${text}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  async patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("PATCH", path, body);
  }
}
