// oxlint-disable no-await-in-loop -- Readiness probes are bounded and intentionally sequential.
import type { ApplianceReadinessOptions } from './Types/appliance-readiness.types.ts'

export async function waitForApplianceReadiness(
    probe: (timeoutMs: number) => Promise<unknown>,
    options: ApplianceReadinessOptions = {},
): Promise<void> {
    const now = options.now ?? (() => performance.now())
    const sleep = options.sleep ?? ((milliseconds: number) => Bun.sleep(milliseconds))
    const deadline = now() + (options.timeoutMs ?? 180_000)
    while (true) {
        const probeBudget = deadline - now()
        if (probeBudget <= 0) break
        try {
            await probe(Math.min(options.probeTimeoutMs ?? 5_000, probeBudget))
            if (now() <= deadline) return
        } catch {
            // A process being running does not prove the appliance is ready.
        }
        const remaining = deadline - now()
        if (remaining > 0) await sleep(Math.min(options.retryIntervalMs ?? 500, remaining))
    }
    throw new Error('RentnerProxy appliance did not become ready')
}
