import { waitForSmoke } from '../../../../scripts/smoke/wait.ts'

export function waitForBeta2(
    check: () => Promise<boolean>,
    label: string,
    timeoutMs = 30_000,
    retryOnError?: (error: unknown) => boolean,
) {
    return waitForSmoke(check, {
        timeoutMs,
        intervalMs: 100,
        probeFirst: true,
        ...(retryOnError ? { retryOnError } : {}),
        timeoutError: () => new Error('Beta 2 fixture timeout: ' + label),
    })
}
