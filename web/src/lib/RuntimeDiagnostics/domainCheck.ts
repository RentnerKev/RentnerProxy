import { z } from 'zod'
import {
    DOMAIN_DIAGNOSTICS_CLIENT_TIMEOUT_MS,
    DOMAIN_DIAGNOSTICS_RESPONSE_LIMIT,
    DOMAIN_DIAGNOSTICS_STAGE_NAMES,
} from '@/config/domain-diagnostics.config.ts'
import { readBoundedStream } from '@/lib/Http/readBoundedStream.ts'
import { domainDiagnosticsInputSchema, domainDiagnosticsResultSchema } from './domainDiagnostics.ts'
import type {
    DomainDiagnosticsInput,
    DomainDiagnosticsResult,
} from './Types/domain-diagnostics.types.ts'
import type { DomainCheckErrorCode } from './Types/domain-check.types.ts'

const errorResponse = z.strictObject({
    error: z.enum([
        'invalid_input',
        'permission_denied',
        'authentication_required',
        'configuration_changed',
        'rate_limited',
        'busy',
        'runtime_unavailable',
    ]),
})

export class DomainCheckError extends Error {
    constructor(readonly code: DomainCheckErrorCode) {
        super(code)
    }
}

export async function requestDomainCheck(
    input: DomainDiagnosticsInput,
    signal: AbortSignal,
): Promise<DomainDiagnosticsResult> {
    const parsed = domainDiagnosticsInputSchema.safeParse(input)
    if (!parsed.success) throw new DomainCheckError('invalid_input')
    const deadline = AbortSignal.timeout(DOMAIN_DIAGNOSTICS_CLIENT_TIMEOUT_MS)
    const combined = AbortSignal.any([signal, deadline])
    try {
        const response = await fetch('/api/admin/diagnostics/domain', {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            credentials: 'same-origin',
            redirect: 'error',
            cache: 'no-store',
            body: JSON.stringify(parsed.data),
            signal: combined,
        })
        if (
            !response.body ||
            response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
                'application/json'
        )
            throw new DomainCheckError('invalid_response')
        const bytes = await readBoundedStream(
            response.body,
            DOMAIN_DIAGNOSTICS_RESPONSE_LIMIT,
            combined,
        )
        let value: unknown
        try {
            value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
        } catch {
            throw new DomainCheckError('invalid_response')
        }
        if (!response.ok) {
            const error = errorResponse.safeParse(value)
            throw new DomainCheckError(error.success ? error.data.error : 'invalid_response')
        }
        const result = domainDiagnosticsResultSchema.safeParse(value)
        if (
            !result.success ||
            result.data.hostType !== input.hostType ||
            result.data.hostId !== input.hostId ||
            result.data.domain !== input.domain
        )
            throw new DomainCheckError('invalid_response')
        combined.throwIfAborted()
        return result.data
    } catch (error) {
        if (signal.aborted) throw error
        if (deadline.aborted) throw new DomainCheckError('timeout')
        if (error instanceof DomainCheckError) throw error
        throw new DomainCheckError('request_failed')
    }
}

export function serializeDomainCheckSummary(result: DomainDiagnosticsResult): string {
    const verified = domainDiagnosticsResultSchema.parse(result)
    const stages = Object.fromEntries(
        DOMAIN_DIAGNOSTICS_STAGE_NAMES.map((name) => {
            const stage = verified.stages[name]
            return [
                name,
                {
                    status: stage.status,
                    code: stage.code,
                    durationMs: stage.durationMs,
                    ...(stage.httpStatus === null ? {} : { httpStatus: stage.httpStatus }),
                },
            ]
        }),
    )
    return (
        JSON.stringify(
            {
                format: 'rentnerproxy-domain-check',
                version: 1,
                checkedAt: verified.checkedAt,
                observationPoint: verified.observationPoint,
                publicReachability: verified.publicReachability,
                hostType: verified.hostType,
                stages,
            },
            null,
            2,
        ) + '\n'
    )
}
