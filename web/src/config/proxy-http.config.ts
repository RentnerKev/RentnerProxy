import type { ProxyHttpSettings } from '../shared/Types/proxy-runtime.types'

// Order is part of the v7 Rust/TypeScript snapshot hash contract.
export const PROXY_HTTP_SETTINGS = [
    {
        key: 'clientMaxBodySizeBytes',
        unit: 'bytes',
        minimum: 1_024,
        maximum: 1_073_741_824,
    },
    {
        key: 'proxyConnectTimeoutSeconds',
        unit: 'seconds',
        minimum: 1,
        maximum: 60,
    },
    {
        key: 'proxyReadTimeoutSeconds',
        unit: 'seconds',
        minimum: 1,
        maximum: 3_600,
    },
    {
        key: 'proxySendTimeoutSeconds',
        unit: 'seconds',
        minimum: 1,
        maximum: 3_600,
    },
    {
        key: 'sendTimeoutSeconds',
        unit: 'seconds',
        minimum: 1,
        maximum: 300,
    },
    {
        key: 'keepaliveTimeoutSeconds',
        unit: 'seconds',
        minimum: 1,
        maximum: 300,
    },
] as const satisfies ReadonlyArray<{
    key: keyof ProxyHttpSettings
    unit: 'bytes' | 'seconds'
    minimum: number
    maximum: number
}>
