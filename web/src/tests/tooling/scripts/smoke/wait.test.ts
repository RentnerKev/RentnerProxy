import { describe, expect, test } from 'bun:test'

import { waitForSmoke } from '../../../../../../scripts/smoke/wait.ts'

function clockOptions(timeoutMs = 25) {
    let time = 0
    const sleeps: number[] = []
    return {
        timeoutMs,
        intervalMs: 10,
        timeoutError: () => new Error('fixture timeout'),
        now: () => time,
        sleep: async (milliseconds: number) => {
            sleeps.push(milliseconds)
            time += milliseconds
        },
        sleeps,
    }
}

describe('waitForSmoke', () => {
    test('retries transient errors and false probes until success', async () => {
        const options = clockOptions()
        let probes = 0
        await waitForSmoke(async () => {
            probes += 1
            if (probes === 1) throw new Error('not ready')
            return probes === 3
        }, options)
        expect(probes).toBe(3)
        expect(options.sleeps).toEqual([10, 10])
    })

    test('immediately propagates an error rejected by caller policy', async () => {
        const options = clockOptions()
        const failure = new Error('terminal failure')
        await expect(
            waitForSmoke(
                async () => {
                    throw failure
                },
                {
                    ...options,
                    retryOnError: (error) => error !== failure,
                },
            ),
        ).rejects.toBe(failure)
        expect(options.sleeps).toEqual([])
    })

    test('stops at the deadline with a caller-owned error', async () => {
        const options = clockOptions()
        let probes = 0
        await expect(
            waitForSmoke(async () => {
                probes += 1
                return false
            }, options),
        ).rejects.toThrow('fixture timeout')
        expect(probes).toBe(3)
        expect(options.sleeps).toEqual([10, 10, 5])
    })

    test('does not probe an expired deadline unless probeFirst is requested', async () => {
        let probes = 0
        const predicate = async () => {
            probes += 1
            return true
        }
        await expect(waitForSmoke(predicate, clockOptions(0))).rejects.toThrow('fixture timeout')
        expect(probes).toBe(0)
        await waitForSmoke(predicate, { ...clockOptions(0), probeFirst: true })
        expect(probes).toBe(1)
    })
})
