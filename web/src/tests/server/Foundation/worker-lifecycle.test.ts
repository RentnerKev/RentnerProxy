import { afterEach, describe, expect, test } from 'bun:test'

import { startWorkerLifecycle } from '@/server/Foundation/worker-lifecycle.server.ts'
import type { WorkerLifecycle } from '@/server/Foundation/Types/worker-lifecycle.types.ts'

const existingListeners = new Set(process.listeners('rentnerproxy:shutdown'))

afterEach(() => {
    for (const listener of process.listeners('rentnerproxy:shutdown')) {
        if (!existingListeners.has(listener))
            process.removeListener('rentnerproxy:shutdown', listener)
    }
})

describe('worker lifecycle', () => {
    test('shutdown waits for a worker that is still loading and stops it once', async () => {
        const loaded = Promise.withResolvers<WorkerLifecycle>()
        const stopped = Promise.withResolvers<void>()
        const calls: string[] = []
        const initializing = startWorkerLifecycle(() => loaded.promise)
        const pending: Array<Promise<void>> = []
        process.emit('rentnerproxy:shutdown', pending)
        process.emit('rentnerproxy:shutdown', pending)
        expect(pending).toHaveLength(1)
        expect(calls).toEqual([])
        loaded.resolve({
            start: () => {
                calls.push('start')
            },
            stop: () => {
                calls.push('stop')
                return stopped.promise
            },
        })
        await initializing
        await Promise.resolve()
        expect(calls).toEqual(['start', 'stop'])
        let drained = false
        const draining = Promise.all(pending).then(() => {
            drained = true
        })
        await Promise.resolve()
        expect(drained).toBe(false)
        stopped.resolve()
        await draining
        expect(drained).toBe(true)
    })

    test('startup and shutdown preserve failures instead of reporting a successful drain', async () => {
        const startupError = new Error('startup failed')
        await expect(
            startWorkerLifecycle(async () => {
                throw startupError
            }),
        ).rejects.toBe(startupError)
        const pendingStartup: Array<Promise<void>> = []
        process.emit('rentnerproxy:shutdown', pendingStartup)
        await expect(Promise.all(pendingStartup)).rejects.toBe(startupError)

        const shutdownError = new Error('shutdown failed')
        await startWorkerLifecycle(async () => ({
            start: () => undefined,
            stop: async () => {
                throw shutdownError
            },
        }))
        const pendingShutdown: Array<Promise<void>> = []
        process.emit('rentnerproxy:shutdown', pendingShutdown)
        await expect(Promise.all(pendingShutdown)).rejects.toBe(shutdownError)
    })
})
