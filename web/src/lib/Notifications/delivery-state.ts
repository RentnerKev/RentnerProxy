import type { NotificationStatus } from './Types/notifications.types.ts'

export function getNotificationDeliveryState(
    delivery: NotificationStatus['deliveries'][number],
    incident: NotificationStatus['incidents'][number] | undefined,
) {
    if (delivery.type === 'test') return 'test'
    if (delivery.category === 'backup')
        return delivery.type === 'success' ? 'backup_succeeded' : 'backup_failed'
    return incident ? (incident.recoveredAt !== null ? 'recovered' : 'active') : 'unknown'
}
