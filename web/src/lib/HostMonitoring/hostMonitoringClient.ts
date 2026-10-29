import { z } from 'zod'
import { HOST_MONITORING_UI } from '@/config/host-monitoring-ui.config.ts'
import { readBoundedStream, ResponseBodyLimitError } from '@/lib/Http/readBoundedStream.ts'
import {
    hostMonitoringSelectorSchema,
    hostMonitoringHistorySchema,
    hostMonitoringSummarySchema,
    saveHostMonitoringPolicySchema,
} from './validation.ts'
import {
    hostMonitoringPolicyResponseSchema,
    hostMonitoringHistoryResponseSchema,
    hostMonitoringSummaryResponseSchema,
} from './hostMonitoringResponses.ts'
import type {
    HostMonitoringHistoryQuery,
    HostMonitoringPolicyView,
    HostMonitoringSummary,
    SaveHostMonitoringPolicy,
} from './Types/host-monitoring.types.ts'
import type {
    HostMonitoringClientErrorCode,
    HostMonitoringHistoryView,
} from './Types/host-monitoring-client.types.ts'

const publicError = z.strictObject({
    error: z.enum([
        'authentication_required',
        'permission_denied',
        'host_not_found',
        'conflict',
        'invalid_input',
        'rate_limited',
        'limit_reached',
        'service_unavailable',
    ]),
})

export class HostMonitoringClientError extends Error {
    constructor(readonly code: HostMonitoringClientErrorCode) {
        super(code)
    }
}

async function request(
    path: string,
    signal?: AbortSignal,
    body?: SaveHostMonitoringPolicy,
): Promise<unknown> {
    const deadline = AbortSignal.timeout(HOST_MONITORING_UI.requestTimeoutMs)
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline
    try {
        combined.throwIfAborted()
        const response = await fetch('/api/admin/monitoring/' + path, {
            method: body === undefined ? 'GET' : 'POST',
            headers:
                body === undefined
                    ? { accept: 'application/json' }
                    : { accept: 'application/json', 'content-type': 'application/json' },
            credentials: 'same-origin',
            redirect: 'error',
            cache: 'no-store',
            signal: combined,
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        if (
            !response.body ||
            response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
                'application/json'
        )
            throw new HostMonitoringClientError('invalid_response')
        const bytes = await readBoundedStream(
            response.body,
            HOST_MONITORING_UI.responseLimitBytes,
            combined,
        )
        let value: unknown
        try {
            value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
        } catch {
            throw new HostMonitoringClientError('invalid_response')
        }
        if (!response.ok) {
            const failure = publicError.safeParse(value)
            throw new HostMonitoringClientError(
                failure.success ? failure.data.error : 'service_unavailable',
            )
        }
        combined.throwIfAborted()
        return value
    } catch (error) {
        if (signal?.aborted) throw new HostMonitoringClientError('aborted')
        if (error instanceof HostMonitoringClientError) throw error
        if (error instanceof ResponseBodyLimitError)
            throw new HostMonitoringClientError('invalid_response')
        throw new HostMonitoringClientError('service_unavailable')
    }
}

export async function getHostMonitoringPolicy(
    proxyHostId: string,
    signal?: AbortSignal,
): Promise<HostMonitoringPolicyView | null> {
    const input = hostMonitoringSelectorSchema.safeParse({ proxyHostId })
    if (!input.success) throw new HostMonitoringClientError('invalid_input')
    const result = hostMonitoringPolicyResponseSchema
        .nullable()
        .safeParse(await request('policy?' + new URLSearchParams(input.data), signal))
    if (!result.success || (result.data !== null && result.data.proxyHostId !== proxyHostId))
        throw new HostMonitoringClientError('invalid_response')
    return result.data
}

export async function getHostMonitoringSummary(
    proxyHostIds: readonly string[],
    signal?: AbortSignal,
): Promise<HostMonitoringSummary> {
    const input = hostMonitoringSummarySchema.safeParse({ proxyHostIds: [...proxyHostIds] })
    if (!input.success) throw new HostMonitoringClientError('invalid_input')
    const params = new URLSearchParams({ proxyHostIds: input.data.proxyHostIds.join(',') })
    const result = hostMonitoringSummaryResponseSchema.safeParse(
        await request('summary?' + params, signal),
    )
    const requested = new Set(proxyHostIds)
    if (!result.success || result.data.summaries.some((row) => !requested.has(row.proxyHostId)))
        throw new HostMonitoringClientError('invalid_response')
    return result.data
}

export async function getHostMonitoringHistory(
    input: HostMonitoringHistoryQuery,
    signal?: AbortSignal,
): Promise<HostMonitoringHistoryView> {
    const parsed = hostMonitoringHistorySchema.safeParse(input)
    if (!parsed.success) throw new HostMonitoringClientError('invalid_input')
    const params = new URLSearchParams({
        proxyHostId: parsed.data.proxyHostId,
        limit: String(parsed.data.limit),
        status: parsed.data.status,
        ...(parsed.data.since ? { since: parsed.data.since } : {}),
        ...(parsed.data.before
            ? { beforeCheckedAt: parsed.data.before.checkedAt, beforeId: parsed.data.before.id }
            : {}),
    })
    const result = hostMonitoringHistoryResponseSchema.safeParse(
        await request('history?' + params, signal),
    )
    if (!result.success) throw new HostMonitoringClientError('invalid_response')
    return result.data
}

export async function saveHostMonitoringPolicy(
    input: SaveHostMonitoringPolicy,
    signal?: AbortSignal,
): Promise<HostMonitoringPolicyView> {
    const parsed = saveHostMonitoringPolicySchema.safeParse(input)
    if (!parsed.success) throw new HostMonitoringClientError('invalid_input')
    const result = hostMonitoringPolicyResponseSchema.safeParse(
        await request('policy', signal, parsed.data),
    )
    if (!result.success || result.data.proxyHostId !== parsed.data.proxyHostId)
        throw new HostMonitoringClientError('invalid_response')
    return result.data
}
