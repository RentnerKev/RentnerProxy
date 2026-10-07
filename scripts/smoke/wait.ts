// oxlint-disable no-await-in-loop -- readiness probes must run serially within their deadline.
import type { SmokeWaitOptions } from './Types/wait.types.ts'

export async function waitForSmoke(
    predicate: () => Promise<boolean>,
    options: SmokeWaitOptions,
): Promise<void> {
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0) {
        throw new Error('Smoke wait timeout must be a nonnegative finite number')
    }
    if (!Number.isFinite(options.intervalMs) || options.intervalMs <= 0) {
        throw new Error('Smoke wait interval must be a positive finite number')
    }
    const now = options.now ?? Date.now
    const sleep = options.sleep ?? Bun.sleep
    const deadline = now() + options.timeoutMs
    let probeFirst = options.probeFirst ?? false

    while (probeFirst || now() < deadline) {
        probeFirst = false
        try {
            if (await predicate()) return
        } catch (error) {
            if (options.retryOnError && !options.retryOnError(error)) throw error
        }
        const remainingMs = deadline - now()
        if (remainingMs <= 0) break
        await sleep(Math.min(options.intervalMs, remainingMs))
    }
    throw options.timeoutError()
}
