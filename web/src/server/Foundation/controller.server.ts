// oxlint-disable no-await-in-loop -- A response stream must be read in order and stopped at its byte limit.
import '@tanstack/react-start/server-only'

import { z } from 'zod'

import type { ServiceHealth } from '../../shared/Types/health.types'
import type { ProxyConfigSource, ProxyRuntimeStatus } from '../../shared/Types/proxy-runtime.types'
import type {
    ProxyAccessLogsQuery,
    ProxyAccessLogsResult,
} from '../../shared/Types/proxy-access-logs.types'
import { getControllerBaseUrl, getControllerToken, isLoopbackControllerUrl } from '../env.server'
import {
    MAX_RUNTIME_PAYLOAD_BYTES,
    PROXY_RUNTIME_REVISION_PATTERN,
} from '../ProxyRuntime/proxy-runtime-snapshot'
import type {
    ProxyRuntimeApplyResponse,
    ProxyRuntimeSnapshot,
} from '../ProxyRuntime/Types/proxy-runtime.types'
import { parseControllerHealth } from './controller-health'
import {
    PROXY_ACCESS_LOGS_MAX_RESPONSE_BYTES,
    proxyAccessLogsQuerySchema,
    proxyAccessLogsResultSchema,
} from '../../features/Admin/ProxyAccessLogs/validation'

const HEALTH_TIMEOUT_MS = 1_200
const STATUS_TIMEOUT_MS = 2_000
export const CONTROLLER_APPLY_TIMEOUT_MS = 20_000
const MAX_RESPONSE_BYTES = 4_096
const MAX_CONFIG_RESPONSE_BYTES = 32 * 1_024 * 1_024

const revisionSchema = z.string().regex(PROXY_RUNTIME_REVISION_PATTERN)
const timestampSchema = z
    .string()
    .max(40)
    .refine((value) => /^\d{4}-\d{2}-\d{2}T/u.test(value) && Number.isFinite(Date.parse(value)))
    .nullable()
const statusSchema = z.object({
    available: z.boolean(),
    running: z.boolean(),
    activeRevision: revisionSchema.nullable(),
    lastApplyAt: timestampSchema,
})
const readinessSchema = z.object({
    status: z.enum(['ready', 'not_ready']),
})
const applySchema = z.object({
    status: z.enum(['applied', 'unchanged']),
    activeRevision: revisionSchema,
    lastApplyAt: timestampSchema,
})

interface ControllerRequestOptions {
    readonly timeoutMs: number
    readonly privileged?: boolean
    readonly confidential?: boolean
    readonly body?: string
    readonly method?: 'GET' | 'PUT' | 'POST' | 'DELETE'
    readonly responseLimit?: number
    readonly allowNotFound?: boolean
    readonly acceptErrorResponse?: boolean
    readonly acceptNonOkJson?: boolean
}

async function readBoundedJson(
    response: Response,
    responseLimit = MAX_RESPONSE_BYTES,
): Promise<unknown> {
    const reader = response.body?.getReader()
    if (!reader) return null
    const chunks: Uint8Array[] = []
    let length = 0

    try {
        for (;;) {
            const chunk = await reader.read()
            if (chunk.done) break
            length += chunk.value.byteLength

            if (length > responseLimit) {
                await reader.cancel()
                return null
            }

            chunks.push(chunk.value)
        }

        return JSON.parse(Buffer.concat(chunks, length).toString('utf8')) as unknown
    } finally {
        reader.releaseLock()
    }
}

export async function controllerRequest(
    path:
        | '/health'
        | '/ready'
        | '/internal/v1/proxy/status'
        | `/internal/v1/proxy/access-logs${string}`
        | '/internal/v1/proxy/config'
        | '/internal/v1/proxy/config/preview'
        | `/internal/v1/proxy/hosts/${string}/config`
        | `/internal/v1/proxy/hosts/${string}/config/preview`
        | '/internal/v1/certificates'
        | `/internal/v1/certificates/${string}`
        | `/internal/v1/certificates/events${string}`
        | '/internal/v1/trusted-cas/validate',
    options: ControllerRequestOptions,
): Promise<unknown> {
    const baseUrl = getControllerBaseUrl()
    const safePath = path.split('?')[0] ?? path
    if (!baseUrl) return null
    if (
        options.confidential &&
        !isLoopbackControllerUrl(baseUrl) &&
        !baseUrl.startsWith('https://')
    )
        return null

    const headers: Record<string, string> = { accept: 'application/json' }
    const isCertificateRequest =
        path === '/internal/v1/certificates' || path.startsWith('/internal/v1/certificates/')
    if (options.privileged || isCertificateRequest) {
        const token = getControllerToken()
        if (
            token === null ||
            (!token && (isCertificateRequest || !isLoopbackControllerUrl(baseUrl)))
        )
            return null
        if (token) headers.authorization = 'Bearer ' + token
    }

    if (options.body !== undefined) headers['content-type'] = 'application/json'
    const requestAbort = new AbortController()
    const timeout = setTimeout(() => requestAbort.abort(), options.timeoutMs)

    try {
        const response = await fetch(baseUrl + path, {
            method: options.method ?? (options.body === undefined ? 'GET' : 'PUT'),
            headers,
            ...(options.body === undefined ? {} : { body: options.body }),
            signal: requestAbort.signal,
            redirect: 'error',
        })

        if (
            (!response.ok && !options.acceptErrorResponse && !options.acceptNonOkJson) ||
            !response.headers.get('content-type')?.includes('application/json')
        ) {
            await response.body?.cancel()
            if (response.status === 404 && options.allowNotFound) return null
            console.warn('[controller] request unavailable', {
                path: safePath,
                status: response.status,
            })
            return null
        }

        const payload = await readBoundedJson(response, options.responseLimit)
        if (response.ok) return payload
        if (options.acceptNonOkJson) return payload

        const error = z.object({ error: z.string().max(64) }).safeParse(payload)
        return error.success ? error.data : null
    } catch {
        console.warn('[controller] request unavailable', { path: safePath })
        return null
    } finally {
        clearTimeout(timeout)
    }
}

const PROXY_ACCESS_LOGS_TIMEOUT_MS = 5_000

export async function getProxyAccessLogs(
    query: ProxyAccessLogsQuery,
): Promise<ProxyAccessLogsResult | null> {
    const parsedQuery = proxyAccessLogsQuerySchema.safeParse(query)
    if (!parsedQuery.success) return null

    const searchParams = new URLSearchParams()
    if (parsedQuery.data.host !== undefined) searchParams.set('host', parsedQuery.data.host)
    if (parsedQuery.data.status !== undefined)
        searchParams.set('status', String(parsedQuery.data.status))
    if (parsedQuery.data.search !== undefined) searchParams.set('search', parsedQuery.data.search)
    if (parsedQuery.data.limit !== undefined)
        searchParams.set('limit', String(parsedQuery.data.limit))
    if (parsedQuery.data.offset !== undefined)
        searchParams.set('offset', String(parsedQuery.data.offset))
    if (parsedQuery.data.snapshot !== undefined)
        searchParams.set('snapshot', parsedQuery.data.snapshot)

    const path = ('/internal/v1/proxy/access-logs?' +
        searchParams.toString()) as `/internal/v1/proxy/access-logs${string}`
    const payload = await controllerRequest(path, {
        timeoutMs: PROXY_ACCESS_LOGS_TIMEOUT_MS,
        privileged: true,
        responseLimit: PROXY_ACCESS_LOGS_MAX_RESPONSE_BYTES,
    })
    const parsed = proxyAccessLogsResultSchema.safeParse(payload)
    return parsed.success ? parsed.data : null
}

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

export async function getProxyRuntimeStatus(): Promise<ProxyRuntimeStatus | null> {
    const payload = await controllerRequest('/internal/v1/proxy/status', {
        timeoutMs: STATUS_TIMEOUT_MS,
        privileged: true,
    })
    const result = statusSchema.safeParse(payload)
    return result.success ? result.data : null
}

export async function applyProxyRuntimeConfiguration(
    snapshot: ProxyRuntimeSnapshot,
    timeoutMs = CONTROLLER_APPLY_TIMEOUT_MS,
): Promise<ProxyRuntimeApplyResponse | null> {
    const body = JSON.stringify(snapshot)
    if (Buffer.byteLength(body) > MAX_RUNTIME_PAYLOAD_BYTES || timeoutMs <= 0) return null

    const payload = await controllerRequest('/internal/v1/proxy/config', {
        timeoutMs: Math.min(timeoutMs, CONTROLLER_APPLY_TIMEOUT_MS),
        privileged: true,
        confidential: snapshot.proxyHosts.some(
            (host) => host.accessPolicy?.basicAuth !== undefined,
        ),
        body,
    })
    const result = applySchema.safeParse(payload)
    return result.success && result.data.activeRevision === snapshot.revision ? result.data : null
}

export async function getActiveProxyConfiguration(): Promise<ProxyConfigSource | null> {
    const payload = await controllerRequest('/internal/v1/proxy/config', {
        timeoutMs: CONTROLLER_APPLY_TIMEOUT_MS,
        privileged: true,
        responseLimit: MAX_CONFIG_RESPONSE_BYTES,
    })
    const result = z
        .object({
            config: z.string().max(MAX_CONFIG_RESPONSE_BYTES),
            activeRevision: revisionSchema.nullable(),
        })
        .safeParse(payload)
    return result.success
        ? { config: result.data.config, revision: result.data.activeRevision }
        : null
}

export async function previewProxyConfiguration(
    snapshot: ProxyRuntimeSnapshot,
): Promise<ProxyConfigSource | null> {
    const body = JSON.stringify(snapshot)
    if (Buffer.byteLength(body) > MAX_RUNTIME_PAYLOAD_BYTES) return null
    const payload = await controllerRequest('/internal/v1/proxy/config/preview', {
        timeoutMs: CONTROLLER_APPLY_TIMEOUT_MS,
        method: 'POST',
        privileged: true,
        confidential: snapshot.proxyHosts.some(
            (host) => host.accessPolicy?.basicAuth !== undefined,
        ),
        body,
        responseLimit: MAX_CONFIG_RESPONSE_BYTES,
    })
    const result = z
        .object({
            config: z.string().max(MAX_CONFIG_RESPONSE_BYTES),
            revision: revisionSchema,
        })
        .safeParse(payload)
    return result.success && result.data.revision === snapshot.revision ? result.data : null
}

const MAX_HOST_CONFIG_RESPONSE_BYTES = 512 * 1_024

export async function getActiveProxyHostConfiguration(
    proxyHostId: string,
): Promise<ProxyConfigSource | null> {
    const id = z.uuid().safeParse(proxyHostId)
    if (!id.success) return null
    const payload = await controllerRequest(
        `/internal/v1/proxy/hosts/${id.data.toLowerCase()}/config`,
        {
            timeoutMs: CONTROLLER_APPLY_TIMEOUT_MS,
            privileged: true,
            responseLimit: MAX_HOST_CONFIG_RESPONSE_BYTES,
            allowNotFound: true,
        },
    )
    const result = z
        .object({
            config: z.string().max(MAX_HOST_CONFIG_RESPONSE_BYTES),
            activeRevision: revisionSchema.nullable(),
        })
        .safeParse(payload)
    return result.success
        ? { config: result.data.config, revision: result.data.activeRevision }
        : null
}

export async function previewProxyHostConfiguration(
    proxyHostId: string,
    snapshot: ProxyRuntimeSnapshot,
): Promise<ProxyConfigSource | null> {
    const id = z.uuid().safeParse(proxyHostId)
    if (!id.success) return null
    const body = JSON.stringify(snapshot)
    if (Buffer.byteLength(body) > MAX_RUNTIME_PAYLOAD_BYTES) return null
    const payload = await controllerRequest(
        `/internal/v1/proxy/hosts/${id.data.toLowerCase()}/config/preview`,
        {
            timeoutMs: CONTROLLER_APPLY_TIMEOUT_MS,
            privileged: true,
            method: 'POST',
            confidential: snapshot.proxyHosts.some(
                (host) => host.accessPolicy?.basicAuth !== undefined,
            ),
            body,
            responseLimit: MAX_HOST_CONFIG_RESPONSE_BYTES,
        },
    )
    const result = z
        .object({
            config: z.string().max(MAX_HOST_CONFIG_RESPONSE_BYTES),
            revision: revisionSchema,
        })
        .safeParse(payload)
    return result.success && result.data.revision === snapshot.revision ? result.data : null
}
