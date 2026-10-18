// oxlint-disable no-await-in-loop -- Each bounded delivery must be durably admitted and acknowledged in order.
import { NOTIFICATION_LIMITS } from '@/config/notifications.config.ts'
import type {
    NotificationCollectedBatch,
    NotificationWorkerDependencies,
} from './Types/notification-worker.types.ts'

export function createNotificationWorker(dependencies: NotificationWorkerDependencies) {
    let timer: ReturnType<typeof setTimeout> | null = null
    let running: Promise<void> | null = null
    let controller: AbortController | null = null
    let started = false
    let stopped = false
    let unavailable = false

    async function collect(signal: AbortSignal) {
        const claim = await dependencies.claimCollection()
        if (!claim) return
        let batch: NotificationCollectedBatch = {
            observations: [],
            certificateCursor: claim.certificateCursor,
        }
        try {
            if (!signal.aborted) batch = await dependencies.collect(claim.certificateCursor, signal)
        } finally {
            // Release the collection fence even when shutdown wins while a claim or read is pending.
            const committed = signal.aborted
                ? { observations: [], certificateCursor: claim.certificateCursor }
                : batch
            if (await dependencies.commitCollection(claim, committed)) dependencies.changed()
        }
    }

    async function deliver(signal: AbortSignal) {
        for (let count = 0; count < NOTIFICATION_LIMITS.deliveriesPerTick; count += 1) {
            if (signal.aborted) return
            // The claim, attempt number and lease are durable before a transport can run.
            const claim = await dependencies.claimDelivery()
            if (!claim) return
            const result = signal.aborted
                ? { success: false as const, code: 'cancelled' as const, retryable: true }
                : await dependencies.deliver(claim, signal)
            // Persist cancellation too: shutdown must not leave an avoidable stale network lease.
            await dependencies.acknowledge(
                claim.leaseToken,
                !result.success && result.code === 'cancelled' && signal.aborted
                    ? { success: false, code: 'cancelled', retryable: true }
                    : result,
            )
            dependencies.changed()
        }
    }

    function schedule() {
        if (!started || stopped || timer) return
        timer = setTimeout(() => {
            timer = null
            void runOnce().finally(schedule)
        }, NOTIFICATION_LIMITS.pollIntervalMs)
        timer.unref()
    }

    function runOnce(): Promise<void> {
        if (stopped) return Promise.resolve()
        if (running) return running
        controller = new AbortController()
        const signal = controller.signal
        running = (async () => {
            // Delivery remains independent of an unavailable event source.
            const outcomes = await Promise.allSettled([collect(signal), deliver(signal)])
            if (outcomes.some((outcome) => outcome.status === 'rejected')) {
                if (!unavailable && !signal.aborted) dependencies.unavailable()
                unavailable = true
            } else unavailable = false
        })().finally(() => {
            running = null
            controller = null
        })
        return running
    }

    return {
        runOnce,
        start() {
            if (started) return
            started = true
            stopped = false
            void runOnce().finally(schedule)
        },
        async stop() {
            stopped = true
            started = false
            if (timer) clearTimeout(timer)
            timer = null
            controller?.abort()
            await running
        },
    }
}
