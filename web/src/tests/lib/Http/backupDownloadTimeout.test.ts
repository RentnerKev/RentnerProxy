import { expect, test } from 'bun:test'
import { createBackupDownloadTimeout } from '@/lib/Http/backupDownloadTimeout.ts'

function clock() {
    let now = 0
    const jobs = new Set<{ at: number; callback: () => void }>()
    return {
        schedule(callback: () => void, delay: number) {
            const job = { at: now + delay, callback }
            jobs.add(job)
            return () => {
                jobs.delete(job)
            }
        },
        advance(milliseconds: number) {
            const end = now + milliseconds
            while (true) {
                const job = [...jobs]
                    .filter((entry) => entry.at <= end)
                    .toSorted((a, b) => a.at - b.at)[0]
                if (!job) break
                now = job.at
                jobs.delete(job)
                job.callback()
            }
            now = end
        },
        pending: () => jobs.size,
    }
}
const timings = { preparationMs: 30, idleMs: 10, connectionMs: 1 }

test('preparation requires real progress and its independent cap expires despite continued work', () => {
    const time = clock()
    let expired = 0
    const timeout = createBackupDownloadTimeout(
        () => {
            expired++
        },
        timings,
        true,
        time.schedule,
    )
    for (let step = 0; step < 3; step++) {
        time.advance(8)
        timeout.progress()
    }
    expect(expired).toBe(0)
    time.advance(6)
    expect(expired).toBe(1)
    expect(time.pending()).toBe(0)
    timeout.progress()
    time.advance(100)
    expect(expired).toBe(1)
})

test('idle preparation and unconsumed streams expire, while active streams exceed every former total budget', () => {
    for (const streaming of [false, true]) {
        const time = clock()
        let expired = false
        const timeout = createBackupDownloadTimeout(
            () => {
                expired = true
            },
            timings,
            true,
            time.schedule,
        )
        if (streaming) timeout.streaming()
        time.advance(10)
        expect(expired).toBe(true)
    }
    const time = clock()
    let expired = false
    const timeout = createBackupDownloadTimeout(
        () => {
            expired = true
        },
        timings,
        true,
        time.schedule,
    )
    timeout.streaming()
    for (let chunk = 0; chunk < 100; chunk++) {
        time.advance(8)
        timeout.progress()
    }
    expect(expired).toBe(false)
    time.advance(10)
    expect(expired).toBe(true)
})

test('downstream allows silent preparation, then replaces its cap with a renewable idle budget', () => {
    const time = clock()
    let expired = false
    const timeout = createBackupDownloadTimeout(
        () => {
            expired = true
        },
        timings,
        false,
        time.schedule,
    )
    time.advance(29)
    expect(expired).toBe(false)
    timeout.streaming()
    time.advance(8)
    timeout.progress()
    time.advance(8)
    expect(expired).toBe(false)
    timeout.clear()
    expect(time.pending()).toBe(0)
    time.advance(100)
    expect(expired).toBe(false)

    const capped = createBackupDownloadTimeout(
        () => {
            expired = true
        },
        timings,
        false,
        time.schedule,
    )
    time.advance(30)
    expect(expired).toBe(true)
    capped.clear()
})
