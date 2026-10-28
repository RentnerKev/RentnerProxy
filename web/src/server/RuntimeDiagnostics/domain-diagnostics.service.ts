import '@tanstack/react-start/server-only'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { DOMAIN_DIAGNOSTICS_RATE_LIMIT } from '@/config/domain-diagnostics.config.ts'
import {
    domainDiagnosticsInputSchema,
    domainDiagnosticsResultSchema,
} from '@/lib/RuntimeDiagnostics/domainDiagnostics.ts'
import type { DomainDiagnosticsResult } from '@/lib/RuntimeDiagnostics/Types/domain-diagnostics.types.ts'
import { requirePermissionService } from '@/server/Auth/Access/authorization.service.ts'
import { isAuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import { inspectControllerDomain } from '@/server/Controller/domain-diagnostics.server.ts'
import { consumeRateLimit, RateLimitError } from '@/server/Valkey/rate-limiter.service.ts'
import { readDomainDiagnosticsContext } from './domain-diagnostics-data.ts'
import { DomainDiagnosticsError, assertDiagnosticsNotAborted } from './domain-diagnostics.errors.ts'
import type { DomainDiagnosticsDependencies } from './Types/domain-diagnostics.types.ts'

export function createDomainDiagnosticsService(dependencies: DomainDiagnosticsDependencies) {
    return async (raw: unknown, signal?: AbortSignal): Promise<DomainDiagnosticsResult> => {
        try {
            assertDiagnosticsNotAborted(signal)
            const parsed = domainDiagnosticsInputSchema.safeParse(raw)
            if (!parsed.success) throw new DomainDiagnosticsError('invalid_input')
            const input = parsed.data
            const permission =
                input.hostType === 'proxy'
                    ? PERMISSIONS.PROXY_HOSTS_VIEW
                    : PERMISSIONS.REDIRECT_HOSTS_VIEW
            const actor = await dependencies.requireActor(permission)
            assertDiagnosticsNotAborted(signal)
            await dependencies.rateLimit(actor.id)
            assertDiagnosticsNotAborted(signal)
            const before = await dependencies.readContext(actor.id, input)
            assertDiagnosticsNotAborted(signal)
            const request = { ...input, expectedRevision: before.revision }
            if (!before.enabled) {
                const skipped = {
                    status: 'unknown' as const,
                    code: 'skipped' as const,
                    durationMs: 0,
                    addresses: [],
                    httpStatus: null,
                }
                return domainDiagnosticsResultSchema.parse({
                    ...request,
                    activeRevision: null,
                    checkedAt: dependencies.now().toISOString(),
                    observationPoint: 'appliance',
                    publicReachability: 'not_checked',
                    stages: {
                        configuration: { ...skipped, code: 'host_not_active' },
                        dns: skipped,
                        upstream: skipped,
                        tls: skipped,
                    },
                })
            }
            const result = await dependencies.inspect(request, signal)
            assertDiagnosticsNotAborted(signal)
            const currentActor = await dependencies.requireActor(permission)
            assertDiagnosticsNotAborted(signal)
            if (currentActor.id !== actor.id)
                throw new DomainDiagnosticsError('configuration_changed')
            const after = await dependencies.readContext(actor.id, input)
            assertDiagnosticsNotAborted(signal)
            if (
                !after.enabled ||
                after.proof !== before.proof ||
                after.revision !== before.revision
            )
                throw new DomainDiagnosticsError('configuration_changed')
            const sanitized = domainDiagnosticsResultSchema.safeParse(result)
            if (
                !sanitized.success ||
                sanitized.data.hostId !== input.hostId ||
                sanitized.data.hostType !== input.hostType ||
                sanitized.data.domain !== input.domain ||
                sanitized.data.expectedRevision !== before.revision
            )
                throw new DomainDiagnosticsError('runtime_unavailable')
            return sanitized.data
        } catch (error) {
            assertDiagnosticsNotAborted(signal)
            if (error instanceof DomainDiagnosticsError || isAuthDomainError(error)) throw error
            throw new DomainDiagnosticsError('runtime_unavailable')
        }
    }
}
export const diagnoseDomainService = createDomainDiagnosticsService({
    requireActor: requirePermissionService,
    rateLimit: async (actorId) => {
        try {
            await consumeRateLimit({ ...DOMAIN_DIAGNOSTICS_RATE_LIMIT, identifier: actorId })
        } catch (error) {
            throw new DomainDiagnosticsError(
                error instanceof RateLimitError ? 'rate_limited' : 'runtime_unavailable',
            )
        }
    },
    readContext: readDomainDiagnosticsContext,
    inspect: inspectControllerDomain,
    now: () => new Date(),
})
