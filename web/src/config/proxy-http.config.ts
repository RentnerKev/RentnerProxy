import type { ProxyHttpSettings } from '../shared/Types/proxy-runtime.types'

export const MAX_PROXY_SETTINGS_SOURCE_LENGTH = 8_192
export const MAX_PROXY_ADVANCED_CONFIG_BYTES = 64 * 1_024

// Order is part of the version 2 Rust/TypeScript snapshot hash contract.
export const PROXY_HTTP_SETTINGS = [
    {
        key: 'clientMaxBodySizeBytes',
        directive: 'client_max_body_size',
        unit: 'bytes',
        minimum: 1_024,
        maximum: 1_073_741_824,
        example: 'client_max_body_size 16m;',
    },
    {
        key: 'proxyConnectTimeoutSeconds',
        directive: 'proxy_connect_timeout',
        unit: 'seconds',
        minimum: 1,
        maximum: 60,
        example: 'proxy_connect_timeout 10s;',
    },
    {
        key: 'proxyReadTimeoutSeconds',
        directive: 'proxy_read_timeout',
        unit: 'seconds',
        minimum: 1,
        maximum: 3_600,
        example: 'proxy_read_timeout 120s;',
    },
    {
        key: 'proxySendTimeoutSeconds',
        directive: 'proxy_send_timeout',
        unit: 'seconds',
        minimum: 1,
        maximum: 3_600,
        example: 'proxy_send_timeout 120s;',
    },
    {
        key: 'sendTimeoutSeconds',
        directive: 'send_timeout',
        unit: 'seconds',
        minimum: 1,
        maximum: 300,
        example: 'send_timeout 60s;',
    },
    {
        key: 'keepaliveTimeoutSeconds',
        directive: 'keepalive_timeout',
        unit: 'seconds',
        minimum: 1,
        maximum: 300,
        example: 'keepalive_timeout 65s;',
    },
] as const satisfies ReadonlyArray<{
    key: keyof ProxyHttpSettings
    directive: string
    unit: 'bytes' | 'seconds'
    minimum: number
    maximum: number
    example: string
}>
