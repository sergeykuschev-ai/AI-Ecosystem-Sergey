import { randomBytes, timingSafeEqual } from 'node:crypto'

export type OzonOAuthConfig = {
  clientId: string
  clientSecret: string
  redirectUri: string
  scope: string
  oauthBaseUrl: string
}

export type OzonOAuthTokens = {
  access_token: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
}

export function newOAuthState(): string {
  return randomBytes(32).toString('base64url')
}

export function stateMatches(expected: string, actual: string): boolean {
  const a = Buffer.from(expected)
  const b = Buffer.from(actual)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function buildAuthorizeUrl(config: OzonOAuthConfig, state: string): string {
  const url = new URL('https://seller.ozon.ru/app/appstore/oauth/authorize')
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  if (config.scope) url.searchParams.set('scope', config.scope)
  url.searchParams.set('state', state)
  url.searchParams.set('prompt', 'select_company')
  return url.toString()
}

async function tokenRequest(config: OzonOAuthConfig, body: Record<string, string>): Promise<OzonOAuthTokens> {
  const response = await fetch(`${config.oauthBaseUrl}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
    cache: 'no-store',
  })
  if (!response.ok) {
    let detail = ''
    try {
      const raw = await response.text()
      const parsed = JSON.parse(raw) as { error?: unknown; error_description?: unknown; message?: unknown }
      const safe = [parsed.error, parsed.error_description, parsed.message].filter((v): v is string => typeof v === 'string').join(': ')
      detail = safe ? `_${safe.replace(/[^a-zA-Z0-9_.:-]+/g, '_').slice(0, 180)}` : ''
    } catch {}
    throw new Error(`OZON_OAUTH_HTTP_${response.status}${detail}`)
  }
  const raw = await response.text()
  let data: OzonOAuthTokens
  try {
    data = JSON.parse(raw) as OzonOAuthTokens
  } catch {
    const form = new URLSearchParams(raw)
    const accessToken = form.get('access_token')
    if (!accessToken) throw new Error('OZON_OAUTH_INVALID_RESPONSE')
    const expiresRaw = form.get('expires_in')
    data = {
      access_token: accessToken,
      ...(form.get('refresh_token') ? { refresh_token: form.get('refresh_token')! } : {}),
      ...(expiresRaw && Number.isFinite(Number(expiresRaw)) ? { expires_in: Number(expiresRaw) } : {}),
      ...(form.get('token_type') ? { token_type: form.get('token_type')! } : {}),
    }
  }
  if (!data.access_token) throw new Error('OZON_OAUTH_INVALID_RESPONSE')
  return data
}

export function exchangeClientCredentials(config: OzonOAuthConfig): Promise<OzonOAuthTokens> {
  return tokenRequest(config, {
    grant_type: 'client_credentials',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    ...(config.scope ? { scope: config.scope } : {}),
  })
}

export function exchangeCode(config: OzonOAuthConfig, code: string): Promise<OzonOAuthTokens> {
  return tokenRequest(config, {
    grant_type: 'authorization_code',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    code,
  })
}

export function refreshAccessToken(config: OzonOAuthConfig, refreshToken: string): Promise<OzonOAuthTokens> {
  return tokenRequest(config, {
    grant_type: 'refresh_token',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
  })
}
