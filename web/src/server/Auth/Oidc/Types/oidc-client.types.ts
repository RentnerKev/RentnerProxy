import type { CustomFetch } from 'openid-client'
import type { WebhookDeliveryOptions } from '@/server/Notifications/Types/transport.types.ts'
import type { OidcClientConfiguration } from './oidc.types.ts'

export interface OidcHttpOptions {
    readonly resolve?: WebhookDeliveryOptions['resolve']
    readonly request?: WebhookDeliveryOptions['request']
    readonly timeoutMs?: number
}

export interface OidcProtocolOptions {
    readonly fetch?: (configuration: OidcClientConfiguration) => CustomFetch
    readonly now?: () => number
}
