import '@tanstack/react-start/server-only'

import { db } from '../../db'
import { isRecord } from '../../shared/Helpers/isRecord'
import type { ServiceHealth } from '../../shared/Types/health.types'

interface DatabaseProbe {
    readonly result: Promise<unknown>
    cancel(): void
}

interface DatabaseHealthDependencies {
    readonly createProbe: () => DatabaseProbe | null
    readonly timeoutMs: number
    readonly warn: (reason: string) => void
}

const HEALTH_TIMEOUT_MS = 1_500
const HEALTH_TIMEOUT = Symbol('database-health-timeout')

function createProbe(): DatabaseProbe | null {
    const query = db.$client`SELECT 1 AS health`.execute()

    return {
        result: query,
        cancel: () => {
            query.cancel()
        },
    }
}

const defaultDependencies: DatabaseHealthDependencies = {
    createProbe,
    timeoutMs: HEALTH_TIMEOUT_MS,
    warn: (reason) => console.warn(`[database] health check unavailable: ${reason}`),
}

export function parseDatabaseHealthResult(value: unknown): boolean {
    return Array.isArray(value) && value.length === 1 && isRecord(value[0]) && value[0].health === 1
}

function classifyDatabaseError(error: unknown): string {
    if (!isRecord(error) || typeof error.code !== 'string') {
        return 'query_failed'
    }

    if (error.code === 'ERR_POSTGRES_CONNECTION_REFUSED') {
        return 'connection_refused'
    }

    if (error.code === 'ERR_POSTGRES_CONNECTION_TIMEOUT') {
        return 'connection_timeout'
    }

    if (error.code.startsWith('ERR_POSTGRES_AUTHENTICATION_')) {
        return 'authentication_failed'
    }

    if (
        error.code === 'ERR_POSTGRES_CONNECTION_CLOSED' ||
        error.code === 'ERR_POSTGRES_CONNECTION_FAILED'
    ) {
        return 'connection_failed'
    }

    return 'query_failed'
}

function unavailable(reason: string, dependencies: DatabaseHealthDependencies): ServiceHealth {
    dependencies.warn(reason)
    return { state: 'unavailable' }
}

export async function checkDatabaseHealth(
    overrides: Partial<DatabaseHealthDependencies> = {},
): Promise<ServiceHealth> {
    const dependencies = { ...defaultDependencies, ...overrides }
    let probe: DatabaseProbe | null

    try {
        probe = dependencies.createProbe()
    } catch {
        return unavailable('invalid_configuration', dependencies)
    }

    if (!probe) {
        return unavailable('invalid_configuration', dependencies)
    }

    const activeProbe = probe
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<typeof HEALTH_TIMEOUT>((resolve) => {
        timeoutHandle = setTimeout(() => {
            try {
                activeProbe.cancel()
            } catch {
                dependencies.warn('cancel_failed')
            }

            resolve(HEALTH_TIMEOUT)
        }, dependencies.timeoutMs)
    })

    try {
        const result = await Promise.race([activeProbe.result, timeout])

        if (result === HEALTH_TIMEOUT) {
            return unavailable('timeout', dependencies)
        }

        return parseDatabaseHealthResult(result)
            ? { state: 'connected' }
            : unavailable('invalid_result', dependencies)
    } catch (error) {
        return unavailable(classifyDatabaseError(error), dependencies)
    } finally {
        clearTimeout(timeoutHandle)
    }
}
