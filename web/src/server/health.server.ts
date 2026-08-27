import '@tanstack/react-start/server-only'

import { checkDatabaseHealth } from '../db/health.server'
import type { FoundationHealth, ServiceHealth } from '../shared/Types/health.types'
import { checkControllerHealth } from './controller.server'
import type { FoundationHealthDependencies, FoundationService } from './Types/health.types'

const defaultDependencies: FoundationHealthDependencies = {
    checkController: checkControllerHealth,
    checkDatabase: checkDatabaseHealth,
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
    const [controller, database] = await Promise.all([
        checkSafely('controller', dependencies.checkController, dependencies.warn),
        checkSafely('database', dependencies.checkDatabase, dependencies.warn),
    ])

    return { controller, database }
}
