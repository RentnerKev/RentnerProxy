import '@tanstack/react-start/server-only'
// oxlint-disable no-await-in-loop, no-unmodified-loop-condition -- Poll root completion serially; shutdown changes the listener-owned stop flag.

import type { WorkerLifecycle } from './Types/worker-lifecycle.types.ts'
import { readRestoreMaintenanceStatus } from '@/server/Backups/restore-maintenance-status.server.ts'

let maintenanceStopped = false

export async function stopWorkersForRestoreMaintenance(): Promise<void> {
    maintenanceStopped = true
    const pending: Array<Promise<void>> = []
    process.emit('rentnerproxy:maintenance', pending)
    await Promise.all(pending)
}

export async function startWorkerLifecycle(load: () => Promise<WorkerLifecycle>): Promise<void> {
    let stoppingRequested = false
    const initializing = load().then(async (worker) => {
        let status = await readRestoreMaintenanceStatus()
        if (
            status?.operation === 'restore' &&
            (status.state === 'queued' ||
                status.state === 'running' ||
                ((status.state === 'interrupted' || status.state === 'failed') &&
                    !['queued', 'validating'].includes(status.phase)))
        ) {
            const restoreId = status.id
            // The new web can prove readiness, but writers wait for confirmed completion.
            while (
                !stoppingRequested &&
                (status?.id !== restoreId ||
                    (status.state !== 'succeeded' &&
                        !(
                            (status.state === 'failed' || status.state === 'interrupted') &&
                            ['queued', 'validating'].includes(status.phase)
                        )))
            ) {
                await new Promise<void>((resolve) => setTimeout(resolve, 250))
                status = await readRestoreMaintenanceStatus()
            }
        }
        if (!maintenanceStopped && !stoppingRequested) worker.start()
        return worker
    })
    let stopping: Promise<void> | null = null
    const stop = (pending: Array<Promise<void>>) => {
        stoppingRequested = true
        stopping ??= initializing.then((worker) => worker.stop())
        pending.push(stopping)
    }
    process.once('rentnerproxy:shutdown', stop)
    process.once('rentnerproxy:maintenance', stop)
    await initializing
    if (maintenanceStopped) await (stopping ??= initializing.then((worker) => worker.stop()))
}
