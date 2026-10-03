import type { CrowdSecControllerRequest } from './Types/crowdsec.types.ts'
import '@tanstack/react-start/server-only'
import { z } from 'zod'

import type {
    CrowdSecDashboard,
    CrowdSecDashboardQuery,
    CrowdSecRuntimeStatus,
} from '@/lib/Admin/CrowdSec/Types/crowdsec.types.ts'

import { controllerRequest } from './transport.server.ts'
import { CROWDSEC_APPLY_TIMEOUT_MS } from '@/config/controller.config.ts'

const CROWDSEC_STATUS_TIMEOUT_MS = 5_000

const CROWDSEC_DASHBOARD_TIMEOUT_MS = 7_000

const crowdSecStatusSchema = z.strictObject({
    mode: z.enum(['disabled', 'managed', 'external']),
    state: z.enum(['disabled', 'starting', 'connected', 'degraded']),
    apiUrl: z.string().url().max(2_048).optional(),
    credentialConfigured: z.boolean(),
    enforcementActive: z.boolean(),
    managedEngine: z.enum([
        'stopped',
        'starting',
        'ready',
        'restarting',
        'degraded',
        'unavailable',
    ]),
    communityEnabled: z.boolean().default(false),
    communityState: z.enum(['disabled', 'starting', 'connected', 'degraded']).default('disabled'),
    consoleState: z
        .enum(['not_enrolled', 'pending', 'connected', 'degraded'])
        .default('not_enrolled'),
    failureBehavior: z.literal('fail_open'),
    clientIpSource: z.literal('caddy'),
})

const crowdSecCountSchema = z.number().int().nonnegative().safe()

const crowdSecOriginCountSchema = z.strictObject({
    origin: z.string().max(80),
    count: crowdSecCountSchema,
})

export const crowdSecDashboardSchema = z.strictObject({
    collectedAt: z.number().int().nonnegative(),
    metrics: z
        .strictObject({
            blockedRequests: crowdSecCountSchema.nullable(),
            activeDecisions: crowdSecCountSchema.nullable(),
            blockedByOrigin: z.array(crowdSecOriginCountSchema).max(12),
            decisionsByOrigin: z.array(crowdSecOriginCountSchema).max(12),
        })
        .nullable(),
    decisions: z
        .strictObject({
            total: crowdSecCountSchema,
            filteredTotal: crowdSecCountSchema,
            offset: crowdSecCountSchema,
            limit: z.number().int().min(1).max(100),
            availableOrigins: z.array(z.string().max(80)).max(100),
            entries: z
                .array(
                    z.strictObject({
                        id: crowdSecCountSchema,
                        scope: z.enum(['Ip', 'Range']),
                        value: z.string().max(64),
                        origin: z.string().max(80),
                        scenario: z.string().max(160),
                        duration: z.string().max(80),
                        countryCode: z
                            .string()
                            .regex(/^[A-Z]{2}$/u)
                            .nullable(),
                    }),
                )
                .max(100),
        })
        .nullable(),
})

export async function enrollCrowdSecConsole(
    enrollmentKey: string,
): Promise<'pending' | 'connection_failed' | 'not_ready' | 'unavailable'> {
    const payload = await controllerRequest('/internal/v1/crowdsec/console/enroll', {
        timeoutMs: 65_000,
        privileged: true,
        confidential: true,
        method: 'POST',
        body: JSON.stringify({ enrollmentKey }),
        acceptErrorResponse: true,
    })
    if (z.strictObject({ status: z.literal('pending') }).safeParse(payload).success)
        return 'pending'
    const failure = z.strictObject({ error: z.string() }).safeParse(payload)
    if (!failure.success) return 'unavailable'
    if (failure.data.error === 'crowdsec_connection_failed') return 'connection_failed'
    if (failure.data.error === 'invalid_crowdsec_configuration' || failure.data.error === 'busy')
        return 'not_ready'
    return 'unavailable'
}

export async function getCrowdSecRuntimeStatus(): Promise<CrowdSecRuntimeStatus | null> {
    const payload = await controllerRequest('/internal/v1/crowdsec/status', {
        timeoutMs: CROWDSEC_STATUS_TIMEOUT_MS,
        privileged: true,
    })
    const result = crowdSecStatusSchema.safeParse(payload)
    return result.success ? result.data : null
}

export async function getCrowdSecDashboard(
    query: CrowdSecDashboardQuery,
): Promise<CrowdSecDashboard | null> {
    const params = new URLSearchParams({
        offset: String(query.offset),
        limit: String(query.limit),
        search: query.search,
        origin: query.origin,
        scope: query.scope,
    })
    const payload = await controllerRequest(`/internal/v1/crowdsec/dashboard?${params}`, {
        timeoutMs: CROWDSEC_DASHBOARD_TIMEOUT_MS,
        responseLimit: 128 * 1024,
        privileged: true,
    })
    const result = crowdSecDashboardSchema.safeParse(payload)
    return result.success ? result.data : null
}

export async function applyCrowdSecConfiguration(
    request: CrowdSecControllerRequest,
): Promise<CrowdSecRuntimeStatus | null> {
    const payload = await controllerRequest('/internal/v1/crowdsec/config', {
        timeoutMs: CROWDSEC_APPLY_TIMEOUT_MS,
        privileged: true,
        confidential: request.mode === 'external',
        body: JSON.stringify(request),
    })
    const result = crowdSecStatusSchema.safeParse(payload)
    return result.success ? result.data : null
}

export async function testCrowdSecControllerConnection(input: {
    readonly apiUrl: string
    readonly apiKey: string
}): Promise<'connected' | 'connection_failed' | 'unavailable'> {
    const payload = await controllerRequest('/internal/v1/crowdsec/test', {
        timeoutMs: CROWDSEC_STATUS_TIMEOUT_MS,
        privileged: true,
        confidential: true,
        method: 'POST',
        body: JSON.stringify({ mode: 'external', ...input }),
        acceptErrorResponse: true,
    })
    const success = z.strictObject({ status: z.literal('connected') }).safeParse(payload)
    if (success.success) return 'connected'
    const failure = z.strictObject({ error: z.string() }).safeParse(payload)
    return failure.success && failure.data.error === 'crowdsec_connection_failed'
        ? 'connection_failed'
        : 'unavailable'
}
