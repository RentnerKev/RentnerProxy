import type { NotificationDestination } from '@/lib/Notifications/Types/notifications.types.ts'

export type WebhookDestination = Extract<NotificationDestination, { kind: 'webhook' }>
export type WebhookResolver = (hostname: string, signal: AbortSignal) => Promise<readonly string[]>
export interface WebhookDeliveryOptions {
    readonly request?: (
        options: import('node:https').RequestOptions,
        listener: (response: import('node:http').IncomingMessage) => void,
    ) => import('node:http').ClientRequest
    readonly resolve?: WebhookResolver
    readonly timeoutMs?: number
    readonly dnsTimeoutMs?: number
}
