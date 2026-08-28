import '@tanstack/react-start/server-only'

import type { ServiceHealth } from '../../shared/Types/health.types'
import { getRedisClient } from './client.server'
import type { RedisHealthDependencies } from './Types/redis.types'

const HEALTH_TIMEOUT_MS = 1_500
const HEALTH_TIMEOUT = Symbol('redis-health-timeout')

function createProbe(): Promise<unknown> | null {
    const client = getRedisClient()
    return client ? client.ping() : null
}

const defaultDependencies: RedisHealthDependencies = {
    createProbe,
    timeoutMs: HEALTH_TIMEOUT_MS,
    warn: (reason) => console.warn(`[redis] health check unavailable: ${reason}`),
}

function unavailable(reason: string, dependencies: RedisHealthDependencies): ServiceHealth {
    dependencies.warn(reason)
    return { state: 'unavailable' }
}

export async function checkRedisHealth(
    overrides: Partial<RedisHealthDependencies> = {},
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
