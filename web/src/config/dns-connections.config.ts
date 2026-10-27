export const MAX_DNS_CONNECTIONS = 100
export const MAX_DNS_CONNECTION_NAME_LENGTH = 100
export const MAX_DNS_CONNECTION_ZONES = 50
export const MAX_CLOUDFLARE_AVAILABLE_ZONES = 500
export const MAX_CLOUDFLARE_API_TOKEN_LENGTH = 512
export const DNS_PROVIDER_IDS = ['cloudflare', 'desec', 'hetzner'] as const
export const MAX_DNS_PROVIDERS = 8

export const DNS_CONNECTION_PROVIDER_RATE_LIMIT = {
    limit: 10,
    scope: 'dns-connection-provider-user',
    windowMs: 60_000,
} as const

export const DNS_CONNECTION_ERROR_CODES = [
    'invalid_input',
    'connection_not_found',
    'connection_conflict',
    'connection_in_use',
    'connection_limit',
    'token_required',
    'zone_not_permitted',
    'zone_limit',
    'provider_unauthorized',
    'provider_unavailable',
    'provider_rate_limited',
    'store_unavailable',
    'credentials_unavailable',
    'controller_unavailable',
] as const
