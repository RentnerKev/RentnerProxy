import '@tanstack/react-start/server-only'

import { publishApplicationChange } from '@/server/WebSockets/applicationChanges.ts'
import { collectNotificationObservations } from './collector.ts'
import { deliverNotification } from './delivery.service.ts'
import { openNotificationDestination } from './notification-settings.ts'
import {
    acknowledgeNotificationDelivery,
    claimNextNotificationDelivery,
    claimNotificationCollection,
    commitNotificationCollection,
} from './notification-repository.ts'
import { createNotificationWorker } from './notification-worker.ts'

export const notificationWorker = createNotificationWorker({
    claimCollection: claimNotificationCollection,
    collect: collectNotificationObservations,
    commitCollection: commitNotificationCollection,
    claimDelivery: claimNextNotificationDelivery,
    acknowledge: acknowledgeNotificationDelivery,
    deliver: async (claim, signal) => {
        try {
            const destination = await openNotificationDestination(claim.channel)
            return await deliverNotification(destination, claim.payload, signal)
        } catch {
            return { success: false, code: 'configuration_unavailable', retryable: false }
        }
    },
    changed: publishApplicationChange,
    unavailable: () => console.warn('[notifications] Delivery worker temporarily unavailable'),
})
