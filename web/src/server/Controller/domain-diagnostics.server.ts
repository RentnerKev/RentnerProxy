import '@tanstack/react-start/server-only'
import { z } from 'zod'
import {
    DOMAIN_DIAGNOSTICS_CONTROLLER_TIMEOUT_MS,
    DOMAIN_DIAGNOSTICS_RESPONSE_LIMIT,
} from '@/config/domain-diagnostics.config.ts'
import {
    domainDiagnosticsControllerInputSchema,
    domainDiagnosticsResultSchema,
} from '@/lib/RuntimeDiagnostics/domainDiagnostics.ts'
import type {
    DomainDiagnosticsControllerInput,
    DomainDiagnosticsResult,
} from '@/lib/RuntimeDiagnostics/Types/domain-diagnostics.types.ts'
import {
    DomainDiagnosticsError,
    assertDiagnosticsNotAborted,
} from '@/server/RuntimeDiagnostics/domain-diagnostics.errors.ts'
import { controllerRequest } from './transport.server.ts'
import type { DomainDiagnosticsProbeOptions } from './Types/domain-diagnostics.types.ts'

const probeOptionsSchema = z.strictObject({
    upstreamOnly: z.boolean().optional(),
    timeoutMs: z.number().int().min(1000).max(10_000).optional(),
})

export function createDomainDiagnosticsController(
    request: typeof controllerRequest = controllerRequest,
) {
    return async (
        input: DomainDiagnosticsControllerInput,
        signal?: AbortSignal,
        options?: DomainDiagnosticsProbeOptions,
    ): Promise<DomainDiagnosticsResult> => {
        assertDiagnosticsNotAborted(signal)
        const parsed = domainDiagnosticsControllerInputSchema.safeParse(input)
        const probeOptions = probeOptionsSchema.safeParse(options === undefined ? {} : options)
        if (!parsed.success || !probeOptions.success)
            throw new DomainDiagnosticsError('invalid_input')
        let payload: unknown
        try {
            payload = await request('/internal/v1/diagnostics/domain', {
                method: 'POST',
                body: JSON.stringify({ ...parsed.data, ...probeOptions.data }),
                privileged: true,
                confidential: true,
                timeoutMs: DOMAIN_DIAGNOSTICS_CONTROLLER_TIMEOUT_MS,
                responseLimit: DOMAIN_DIAGNOSTICS_RESPONSE_LIMIT,
                acceptNonOkJson: true,
                ...(signal ? { signal } : {}),
            })
        } catch {
            assertDiagnosticsNotAborted(signal)
            throw new DomainDiagnosticsError('runtime_unavailable')
        }
        assertDiagnosticsNotAborted(signal)
        const error = z
            .strictObject({ error: z.enum(['invalid_input', 'busy', 'runtime_unavailable']) })
            .safeParse(payload)
        if (error.success) throw new DomainDiagnosticsError(error.data.error)
        const result = domainDiagnosticsResultSchema.safeParse(payload)
        if (
            !result.success ||
            result.data.hostType !== parsed.data.hostType ||
            result.data.hostId !== parsed.data.hostId ||
            result.data.domain !== parsed.data.domain ||
            result.data.expectedRevision !== parsed.data.expectedRevision
        )
            throw new DomainDiagnosticsError('runtime_unavailable')
        return result.data
    }
}
export const inspectControllerDomain = createDomainDiagnosticsController()
