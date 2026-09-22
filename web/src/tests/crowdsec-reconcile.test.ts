import { describe, expect, spyOn, test } from 'bun:test'

import { createCrowdSecReconciler } from '../server/Admin/CrowdSec/crowdsec-reconcile'

interface Snapshot {
    readonly fingerprint: string
}

describe('CrowdSec runtime reconciliation', () => {
    test('coalesces concurrent requests and confirms the latest configuration', async () => {
        const first: Snapshot = { fingerprint: 'first' }
        const latest: Snapshot = { fingerprint: 'latest' }
        let current = first
        let applyStarted!: () => void
        let releaseApply!: () => void
        const started = new Promise<void>((resolve) => (applyStarted = resolve))
        const gate = new Promise<void>((resolve) => (releaseApply = resolve))
        const applied: string[] = []
        const reconciler = createCrowdSecReconciler({
            load: async () => current,
            apply: async (snapshot) => {
                applied.push(snapshot.fingerprint)
                if (applied.length === 1) {
                    current = latest
                    applyStarted()
                    await gate
                }
                return true
            },
            hasDrift: async () => false,
        })

        const firstRequest = reconciler()
        await started
        const secondRequest = reconciler()
        expect(secondRequest).toBe(firstRequest)
        releaseApply()

        expect(await firstRequest).toBe('applied')
        expect(applied).toEqual(['first', 'latest'])
        await reconciler.stop()
    })

    test('returns pending for a stalled read and resumes after it is released', async () => {
        const current: Snapshot = { fingerprint: 'current' }
        let releaseRead!: (snapshot: Snapshot) => void
        const stalled = new Promise<Snapshot>((resolve) => (releaseRead = resolve))
        let reads = 0
        let applies = 0
        const reconciler = createCrowdSecReconciler(
            {
                load: async () => {
                    reads += 1
                    return reads === 1 ? stalled : current
                },
                apply: async () => {
                    applies += 1
                    return true
                },
                hasDrift: async () => false,
            },
            25,
        )

        expect(await reconciler()).toBe('pending')
        expect(applies).toBe(0)
        releaseRead(current)
        await Bun.sleep(0)
        expect(await reconciler()).toBe('applied')
        expect(applies).toBeGreaterThanOrEqual(2)
        await reconciler.stop()
    })

    test('recovers from a transient apply failure without exposing its error', async () => {
        const warnings = spyOn(console, 'warn').mockImplementation(() => undefined)
        let shouldFail = true
        let recovered!: () => void
        const recovery = new Promise<void>((resolve) => (recovered = resolve))
        const reconciler = createCrowdSecReconciler(
            {
                load: async () => ({ fingerprint: 'current' }),
                apply: async () => {
                    if (shouldFail) return false
                    recovered()
                    return true
                },
                hasDrift: async () => true,
            },
            25,
        )

        try {
            expect(await reconciler()).toBe('pending')
            expect(warnings.mock.calls.flat().join(' ')).not.toContain('credential')
            shouldFail = false
            await reconciler.checkDrift()
            await recovery
        } finally {
            await reconciler.stop()
            warnings.mockRestore()
        }
    })

    test('does not reapply a healthy provider during drift checks', async () => {
        let applies = 0
        let applied!: () => void
        const firstApply = new Promise<void>((resolve) => (applied = resolve))
        const reconciler = createCrowdSecReconciler({
            load: async () => ({ fingerprint: 'current' }),
            apply: async () => {
                applies += 1
                applied()
                return true
            },
            hasDrift: async () => false,
        })

        reconciler.start()
        await firstApply
        await reconciler.checkDrift()
        expect(applies).toBe(1)
        await reconciler.stop()
    })
})
