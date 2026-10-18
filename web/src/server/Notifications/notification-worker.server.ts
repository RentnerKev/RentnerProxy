import '@tanstack/react-start/server-only'

import { publishApplicationChange } from '@/server/WebSockets/applicationChanges.ts'
import { collectNotificationObservations } from './collector.ts'
import { deliverAuthorizedNotificationClaim } from './notification-delivery.server.ts'
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
    deliver: deliverAuthorizedNotificationClaim,
    changed: publishApplicationChange,
    unavailable: () => console.warn('[notifications] Delivery worker temporarily unavailable'),
})
