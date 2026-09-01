import '@tanstack/react-start/server-only'

import type { FoundationHealth, ServiceHealth } from '../../shared/Types/health.types'
import { checkControllerHealth, checkControllerReadiness } from './controller.server'
import { checkDatabaseHealth } from './database-health.server'
import { checkRedisHealth } from '../redis/health.server'
import type { FoundationHealthDependencies, FoundationService } from './Types/health.types'

const defaultDependencies: FoundationHealthDependencies = {
    checkController: checkControllerHealth,
    checkDatabase: checkDatabaseHealth,
    checkRedis: checkRedisHealth,
    warn: (service) => console.warn(`[foundation] unexpected ${service} health check failure`),
}

async function checkSafely(
    service: FoundationService,
    check: () => Promise<ServiceHealth>,
    warn: (service: FoundationService) => void,
): Promise<ServiceHealth> {
    try {
        return await check()
    } catch {
        warn(service)
        return { state: 'unavailable' }
    }
}

export async function checkFoundationHealth(
    overrides: Partial<FoundationHealthDependencies> = {},
): Promise<FoundationHealth> {
    const dependencies = { ...defaultDependencies, ...overrides }
    const [controller, database, redis] = await Promise.all([
        checkSafely('controller', dependencies.checkController, dependencies.warn),
        checkSafely('database', dependencies.checkDatabase, dependencies.warn),
        checkSafely('redis', dependencies.checkRedis, dependencies.warn),
    ])

    return { controller, database, redis }
}

export async function checkFoundationReadiness(
    overrides: Partial<FoundationHealthDependencies> = {},
): Promise<boolean> {
    const health = await checkFoundationHealth({
        checkController: checkControllerReadiness,
        ...overrides,
    })
    return Object.values(health).every((service) => service.state === 'connected')
}
