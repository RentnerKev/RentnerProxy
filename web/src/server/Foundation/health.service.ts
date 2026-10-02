import '@tanstack/react-start/server-only'

import type { FoundationHealth, ServiceHealth } from '@/shared/Types/health.types.ts'
import { checkControllerHealth, checkControllerReadiness } from './controller.server.ts'
import { checkDatabaseHealth } from './database-health.server.ts'
import { checkValkeyHealth } from '@/server/valkey/health.server.ts'
import type { FoundationHealthDependencies, FoundationService } from './Types/health.types.ts'

const defaultDependencies: FoundationHealthDependencies = {
    checkController: checkControllerHealth,
    checkDatabase: checkDatabaseHealth,
    checkValkey: checkValkeyHealth,
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

export async function checkFoundationHealthService(
    overrides: Partial<FoundationHealthDependencies> = {},
): Promise<FoundationHealth> {
    const dependencies = { ...defaultDependencies, ...overrides }
    const [controller, database, valkey] = await Promise.all([
        checkSafely('controller', dependencies.checkController, dependencies.warn),
        checkSafely('database', dependencies.checkDatabase, dependencies.warn),
        checkSafely('valkey', dependencies.checkValkey, dependencies.warn),
    ])

    return { controller, database, valkey }
}

export async function checkFoundationReadinessService(
    overrides: Partial<FoundationHealthDependencies> = {},
): Promise<boolean> {
    const health = await checkFoundationHealthService({
        checkController: checkControllerReadiness,
        ...overrides,
    })
    return Object.values(health).every((service) => service.state === 'connected')
}
