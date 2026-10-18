import type { NotificationPayload } from '@/lib/Notifications/Types/notifications.types.ts'

export const PAYLOAD: NotificationPayload = {
    schemaVersion: 1,
    id: 'event-123',
    incidentId: 'incident-1',
    type: 'incident',
    category: 'ddns',
    severity: 'error',
    resourceId: 'redacted-id',
    code: 'ddns_update_failed',
    occurredAt: '2026-10-18T12:00:00Z',
    startedAt: '2026-10-18T12:00:00Z',
    failures: 2,
}
