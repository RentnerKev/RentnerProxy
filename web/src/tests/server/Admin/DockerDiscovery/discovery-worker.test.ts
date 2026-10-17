import { expect, mock, spyOn, test } from 'bun:test'
import { createDiscoveryWorker } from '@/server/Admin/DockerDiscovery/discovery-worker.ts'

test('event bursts share one reconciliation and shutdown drains it without new writes', async () => {
    let finish: (() => void) | undefined
    const step = mock(
        () =>
            new Promise<void>((resolve) => {
                finish = resolve
            }),
    )
    const worker = createDiscoveryWorker(step)
    const requests = Array.from({ length: 100 }, () => worker.trigger())
    expect(step).toHaveBeenCalledTimes(1)
    let drained = false
    const stopping = worker.stop().then(() => {
        drained = true
    })
    await Promise.resolve()
    expect(drained).toBe(false)
    finish?.()
    await Promise.all([...requests, stopping])
    await worker.trigger()
    expect(step).toHaveBeenCalledTimes(1)
})
test('a failed reconciliation is retried and logs only the outage transition', async () => {
    const warning = spyOn(console, 'warn').mockImplementation(() => undefined)
    let failing = true
    const step = mock(async () => {
        if (failing) throw new Error('synthetic private provider payload')
    })
    const worker = createDiscoveryWorker(step)
    try {
        await worker.trigger()
        await worker.trigger()
        expect(warning).toHaveBeenCalledTimes(1)
        expect(JSON.stringify(warning.mock.calls)).not.toContain('private provider')
        failing = false
        await worker.trigger()
        failing = true
        await worker.trigger()
        expect(warning).toHaveBeenCalledTimes(2)
        expect(step).toHaveBeenCalledTimes(4)
    } finally {
        await worker.stop()
        warning.mockRestore()
    }
})
