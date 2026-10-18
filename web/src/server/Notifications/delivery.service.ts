import type {
    NotificationDestination,
    NotificationDeliveryResult,
    NotificationPayload,
} from '@/lib/Notifications/Types/notifications.types.ts'
import { sendNotificationEmailService } from '@/server/Mail/mail.service.ts'
import { deliverWebhookNotification } from './webhook-delivery.ts'
import { parseWebhookDestination } from './webhook-policy.ts'

export function validateNotificationDestination(destination: NotificationDestination): void {
    if (destination.kind === 'webhook') {
        parseWebhookDestination(destination)
        return
    }
    if (
        destination.recipients.length < 1 ||
        destination.recipients.length > 16 ||
        destination.recipients.some(
            (recipient) =>
                recipient.length > 254 ||
                !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(
                    recipient,
                ),
        )
    )
        throw new Error('destination_blocked')
}

export async function deliverNotification(
    destination: NotificationDestination,
    payload: NotificationPayload,
    signal?: AbortSignal,
): Promise<NotificationDeliveryResult> {
    try {
        validateNotificationDestination(destination)
    } catch {
        return { success: false, code: 'destination_blocked', retryable: false }
    }
    // Construct an allowlisted object so incidental source fields can never cross the transport boundary.
    const safe: NotificationPayload = {
        schemaVersion: 1,
        id: payload.id,
        incidentId: payload.incidentId,
        type: payload.type,
        category: payload.category,
        severity: payload.severity,
        resourceId: payload.resourceId,
        code: payload.code,
        occurredAt: payload.occurredAt,
        startedAt: payload.startedAt,
        failures: payload.failures,
    }
    try {
        return destination.kind === 'email'
            ? await sendNotificationEmailService(destination.recipients, safe, signal)
            : await deliverWebhookNotification(destination, safe, signal)
    } catch {
        return { success: false, code: 'destination_unavailable', retryable: true }
    }
}
