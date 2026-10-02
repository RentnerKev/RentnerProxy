import '@tanstack/react-start/server-only'

import type { ServiceHealth } from '@/shared/Types/health.types.ts'
import { getValkeyClient } from './client.server.ts'
import type { ValkeyHealthDependencies } from './Types/valkey.types.ts'

const HEALTH_TIMEOUT_MS = 1_500
const HEALTH_TIMEOUT = Symbol('valkey-health-timeout')

function createProbe(): Promise<unknown> | null {
    const client = getValkeyClient()
    return client ? client.ping() : null
}

const defaultDependencies: ValkeyHealthDependencies = {
    createProbe,
    timeoutMs: HEALTH_TIMEOUT_MS,
    warn: (reason) => console.warn(`[valkey] health check unavailable: ${reason}`),
}

function unavailable(reason: string, dependencies: ValkeyHealthDependencies): ServiceHealth {
    dependencies.warn(reason)
    return { state: 'unavailable' }
}

export async function checkValkeyHealth(
    overrides: Partial<ValkeyHealthDependencies> = {},
): Promise<ServiceHealth> {
    const dependencies = { ...defaultDependencies, ...overrides }
    let probe: Promise<unknown> | null

    try {
        probe = dependencies.createProbe()
    } catch {
        return unavailable('invalid_configuration', dependencies)
    }

    if (!probe) {
        return unavailable('invalid_configuration', dependencies)
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<typeof HEALTH_TIMEOUT>((resolve) => {
        timeoutHandle = setTimeout(() => resolve(HEALTH_TIMEOUT), dependencies.timeoutMs)
    })

    try {
        const result = await Promise.race([probe, timeout])

        if (result === HEALTH_TIMEOUT) {
            return unavailable('timeout', dependencies)
        }

        return result === 'PONG'
            ? { state: 'connected' }
            : unavailable('invalid_result', dependencies)
    } catch {
        return unavailable('request_failed', dependencies)
    } finally {
        clearTimeout(timeoutHandle)
    }
}
