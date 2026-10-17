export const MAX_DDNS_TARGETS = 100
export const DDNS_AUTO_ZONE = 'automatic'
export const DDNS_LIVE_QUERY_KEYS = [['ddns', 'status']] as const
export const DNS_CONNECTION_LIVE_QUERY_KEYS = [
    ['dns-connections'],
    ['ddns', 'connections'],
] as const
export const DDNS_PREVIEW_TTL_MS = 180_000
export const DDNS_QUERY_KEYS = {
    status: ['ddns', 'status'],
    connections: ['ddns', 'connections'],
} as const
export const DDNS_PROVIDER_RATE_LIMIT = {
    scope: 'ddns-provider',
    limit: 10,
    windowMs: 60_000,
} as const
export const DDNS_MUTATION_RATE_LIMIT = {
    scope: 'ddns-mutation',
    limit: 20,
    windowMs: 60_000,
} as const
