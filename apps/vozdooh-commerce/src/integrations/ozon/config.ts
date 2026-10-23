/** Server-only configuration for the Ozon Seller API integration.
 * Reads the Client-Id / Api-Key (or an OAuth token) from mounted secret files.
 * Secret values are never logged, echoed or returned — failures carry codes only.
 */

export const OZON_DEFAULT_CLIENT_ID_FILE = '/opt/stores-web/secrets/vozdooh-ozon-client-id'
export const OZON_DEFAULT_API_KEY_FILE = '/opt/stores-web/secrets/vozdooh-ozon-api-key'
export const OZON_DEFAULT_BASE_URL = 'https://api-seller.ozon.ru'
export const OZON_DEFAULT_OAUTH_BASE_URL = 'https://xapi.ozon.ru/oauth'

export class OzonConfigError extends Error {
  constructor(public code: string) { super(code) }
}

export type OzonAuthConfig =
  | { type: 'api-key'; clientId: string; apiKey: string }
  | { type: 'oauth'; token: string }

export type OzonClientConfig = {
  auth: OzonAuthConfig
  baseUrl: string
  timeoutMs: number
  maxAttempts: number
  retryBaseMs: number
  /** Never set from the environment. Tests and a future approved workflow opt in explicitly. */
  allowMutations: boolean
}

/** The Ozon Delivery routes stay inert unless the owner explicitly enables them. */
export function ozonDeliveryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OZON_DELIVERY_ENABLED === 'true'
}

function readSecretFile(path: string, code: string): string {
  let raw: string
  try {
    // Lazy import keeps client bundlers from pulling node:fs into browser chunks.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    raw = require('node:fs').readFileSync(path, 'utf8') as string
  } catch {
    throw new OzonConfigError(code)
  }
  const value = raw.trim()
  if (!value) throw new OzonConfigError(code)
  return value
}

export function loadOzonAuthFromEnv(env: NodeJS.ProcessEnv = process.env): OzonAuthConfig {
  const tokenFile = env.OZON_OAUTH_TOKEN_FILE
  if (tokenFile) return { type: 'oauth', token: readSecretFile(tokenFile, 'OZON_OAUTH_TOKEN_UNAVAILABLE') }
  const clientId = readSecretFile(env.OZON_CLIENT_ID_FILE ?? OZON_DEFAULT_CLIENT_ID_FILE, 'OZON_CLIENT_ID_UNAVAILABLE')
  const apiKey = readSecretFile(env.OZON_API_KEY_FILE ?? OZON_DEFAULT_API_KEY_FILE, 'OZON_API_KEY_UNAVAILABLE')
  return { type: 'api-key', clientId, apiKey }
}

export function loadOzonOAuthClientConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    clientId: readSecretFile(env.OZON_CLIENT_ID_FILE ?? OZON_DEFAULT_CLIENT_ID_FILE, 'OZON_CLIENT_ID_UNAVAILABLE'),
    clientSecret: readSecretFile(env.OZON_CLIENT_SECRET_FILE ?? env.OZON_API_KEY_FILE ?? OZON_DEFAULT_API_KEY_FILE, 'OZON_CLIENT_SECRET_UNAVAILABLE'),
    redirectUri: env.OZON_OAUTH_REDIRECT_URI ?? 'https://vozdooh27.ru/api/ozon/oauth/callback',
    scope: env.OZON_OAUTH_SCOPE ?? '',
    oauthBaseUrl: env.OZON_OAUTH_BASE_URL ?? OZON_DEFAULT_OAUTH_BASE_URL,
  }
}

export function loadOzonClientConfig(env: NodeJS.ProcessEnv = process.env): OzonClientConfig {
  return {
    auth: loadOzonAuthFromEnv(env),
    baseUrl: env.OZON_API_BASE_URL ?? OZON_DEFAULT_BASE_URL,
    timeoutMs: 10_000,
    maxAttempts: 3,
    retryBaseMs: 500,
    allowMutations: false,
  }
}
