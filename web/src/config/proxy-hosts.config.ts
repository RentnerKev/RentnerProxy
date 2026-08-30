export const PROXY_HOST_FORWARD_SCHEMES = ['http', 'https'] as const

export type ProxyHostForwardScheme = (typeof PROXY_HOST_FORWARD_SCHEMES)[number]

export const MAX_PROXY_HOST_DOMAINS = 50
