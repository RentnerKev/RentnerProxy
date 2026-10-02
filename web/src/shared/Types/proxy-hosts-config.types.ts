import { PROXY_HOST_FORWARD_SCHEMES } from '@/config/proxy-hosts.config.ts'
export type ProxyHostForwardScheme = (typeof PROXY_HOST_FORWARD_SCHEMES)[number]
