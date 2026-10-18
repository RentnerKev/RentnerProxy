import '@tanstack/react-start/server-only'

import type { WorkerLifecycle } from './Types/worker-lifecycle.types.ts'

export async function startWorkerLifecycle(load: () => Promise<WorkerLifecycle>): Promise<void> {
    const initializing = load().then((worker) => {
        worker.start()
        return worker
    })
    process.once('rentnerproxy:shutdown', (pending: Array<Promise<void>>) => {
        pending.push(initializing.then((worker) => worker.stop()))
    })
    await initializing
}
