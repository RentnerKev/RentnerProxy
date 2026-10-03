import '@tanstack/react-start/server-only'
import { z } from 'zod'
import type { ServiceHealth } from '@/lib/FoundationStatus/Types/health.types.ts'

import { parseControllerHealth } from './controller-health.ts'

import { controllerRequest } from './transport.server.ts'

const HEALTH_TIMEOUT_MS = 1_200

const readinessSchema = z.object({
    status: z.enum(['ready', 'not_ready']),
})

export async function checkControllerHealth(): Promise<ServiceHealth> {
    const payload = await controllerRequest('/health', { timeoutMs: HEALTH_TIMEOUT_MS })
    return parseControllerHealth(payload) ? { state: 'connected' } : { state: 'unavailable' }
}

export async function checkControllerReadiness(): Promise<ServiceHealth> {
    const payload = await controllerRequest('/ready', {
        timeoutMs: HEALTH_TIMEOUT_MS,
        acceptNonOkJson: true,
    })
    const result = readinessSchema.safeParse(payload)
    return result.success && result.data.status === 'ready'
        ? { state: 'connected' }
        : { state: 'unavailable' }
}
