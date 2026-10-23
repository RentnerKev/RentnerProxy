import { waitForSmoke } from '../../../../scripts/smoke/wait.ts'

export function waitForBeta2(check: () => Promise<boolean>, label: string, timeoutMs = 30_000) {
    return waitForSmoke(check, {
        timeoutMs,
        intervalMs: 100,
        probeFirst: true,
        timeoutError: () => new Error('Beta 2 fixture timeout: ' + label),
    })
}
