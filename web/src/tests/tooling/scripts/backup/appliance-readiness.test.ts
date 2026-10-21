import { describe, expect, test } from 'bun:test'
import { waitForApplianceReadiness } from '../../../../../../scripts/backup/appliance-readiness.ts'

describe('bounded appliance readiness', () => {
    test('retries failed readiness and clips each probe and sleep to the remaining budget', async () => {
        let clock = 0
        const probes: number[] = []
        const sleeps: number[] = []
        await waitForApplianceReadiness(
            async (timeout) => {
                probes.push(timeout)
                clock += 20
                if (probes.length < 3) throw new Error('not ready')
            },
            {
                timeoutMs: 100,
                probeTimeoutMs: 50,
                retryIntervalMs: 15,
                now: () => clock,
                sleep: async (duration) => {
                    sleeps.push(duration)
                    clock += duration
                },
            },
        )
        expect(probes).toEqual([50, 50, 30])
        expect(sleeps).toEqual([15, 15])
    })

    test('never treats a late successful probe as readiness within the deadline', async () => {
        let clock = 0
        await expect(
            waitForApplianceReadiness(
                async () => {
                    clock = 101
                },
                {
                    timeoutMs: 100,
                    now: () => clock,
                    sleep: async () => {
                        throw new Error('must not sleep past the deadline')
                    },
                },
            ),
        ).rejects.toThrow('RentnerProxy appliance did not become ready')
    })

    test('stops retrying at the deadline and clips the final sleep', async () => {
        let clock = 0
        let calls = 0
        const sleeps: number[] = []
        await expect(
            waitForApplianceReadiness(
                async () => {
                    calls++
                    clock += 40
                    throw new Error('failed')
                },
                {
                    timeoutMs: 100,
                    retryIntervalMs: 500,
                    now: () => clock,
                    sleep: async (duration) => {
                        sleeps.push(duration)
                        clock += duration
                    },
                },
            ),
        ).rejects.toThrow('did not become ready')
        expect(calls).toBe(1)
        expect(sleeps).toEqual([60])
    })
})
