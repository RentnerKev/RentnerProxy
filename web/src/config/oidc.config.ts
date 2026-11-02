export const OIDC_SETTINGS_KEY = 'oidc_providers_v1'
export const OIDC_SECRET_CONTEXT = 'rentnerproxy:oidc:client-secret:'
export const OIDC_FLOW_COOKIE_NAME = '__Host-rentnerproxy_oidc_flow'
export const OIDC_DEVELOPMENT_FLOW_COOKIE_NAME = 'rentnerproxy_oidc_flow'
export const OIDC_LINK_FLOW_COOKIE_NAME = '__Host-rentnerproxy_oidc_link'
export const OIDC_DEVELOPMENT_LINK_FLOW_COOKIE_NAME = 'rentnerproxy_oidc_link'
export const OIDC_CALLBACK_PATH = '/api/auth/oidc/callback'
export const OIDC_LIMITS = {
    providers: 16,
    bindings: 128,
    endpointOrigins: 8,
    privateCidrs: 16,
    urlLength: 2_048,
    responseBytes: 262_144,
    responseHeaderBytes: 8_192,
    cookieHeaderBytes: 16_384,
    forwardedForHeaderBytes: 4_096,
    startBodyBytes: 256,
    configurationBytes: 1_048_576,
    dnsAnswers: 64,
    jwksKeys: 32,
    requestTimeoutMs: 5_000,
    issuedAtClockSkewSeconds: 5,
    inputTimeoutMs: 2_000,
    flowDurationMs: 5 * 60 * 1_000,
    publicCatalogCacheMs: 1_000,
    discoveryCacheMs: 5 * 60 * 1_000,
    cacheEntries: 32,
    callbackBytes: 8_192,
    activeExchanges: 8,
    groups: 128,
    groupLength: 255,
    groupMappings: 32,
    roleKeys: 32,
    sessionDurationMs: 15 * 60 * 1_000,
} as const
export const OIDC_RATE_LIMIT = {
    scope: 'oidc-login',
    limit: 20,
    windowMs: 60_000,
} as const
export const OIDC_CONFIGURATION_RATE_LIMIT = {
    scope: 'oidc-configuration',
    limit: 10,
    windowMs: 60_000,
} as const
