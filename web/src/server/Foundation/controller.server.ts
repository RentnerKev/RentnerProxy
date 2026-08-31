// oxlint-disable no-await-in-loop -- A response stream must be read in order and stopped at its byte limit.
import '@tanstack/react-start/server-only'

import { z } from 'zod'

import type { ServiceHealth } from '../../shared/Types/health.types'
import type { ProxyRuntimeStatus } from '../../shared/Types/proxy-runtime.types'
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

const HEALTH_TIMEOUT_MS = 1_200
const STATUS_TIMEOUT_MS = 2_000
export const CONTROLLER_APPLY_TIMEOUT_MS = 20_000
const MAX_RESPONSE_BYTES = 4_096

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
const applySchema = z.object({
    status: z.enum(['applied', 'unchanged']),
    activeRevision: revisionSchema,
    lastApplyAt: timestampSchema,
})

interface ControllerRequestOptions {
    readonly timeoutMs: number
    readonly privileged?: boolean
    readonly body?: string
}

async function readBoundedJson(response: Response): Promise<unknown> {
    const reader = response.body?.getReader()
    if (!reader) return null
    const chunks: Uint8Array[] = []
    let length = 0

    try {
        for (;;) {
            const chunk = await reader.read()
            if (chunk.done) break
            length += chunk.value.byteLength

            if (length > MAX_RESPONSE_BYTES) {
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

async function controllerRequest(
    path: '/health' | '/internal/v1/proxy/status' | '/internal/v1/proxy/config',
    options: ControllerRequestOptions,
): Promise<unknown> {
    const baseUrl = getControllerBaseUrl()
    if (!baseUrl) return null

    const headers: Record<string, string> = { accept: 'application/json' }
    if (options.privileged) {
        const token = getControllerToken()
        if (token === null || (!token && !isLoopbackControllerUrl(baseUrl))) return null
        if (token) headers.authorization = 'Bearer ' + token
    }

    if (options.body !== undefined) headers['content-type'] = 'application/json'
    const requestAbort = new AbortController()
    const timeout = setTimeout(() => requestAbort.abort(), options.timeoutMs)

    try {
        const response = await fetch(baseUrl + path, {
            method: options.body === undefined ? 'GET' : 'PUT',
            headers,
            ...(options.body === undefined ? {} : { body: options.body }),
            signal: requestAbort.signal,
            redirect: 'error',
        })

        if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
            await response.body?.cancel()
            console.warn('[controller] request unavailable', { path, status: response.status })
            return null
        }

        return await readBoundedJson(response)
    } catch {
        // Never log the URL, token, response body, or a raw network/engine error.
        console.warn('[controller] request unavailable', { path })
        return null
    } finally {
        clearTimeout(timeout)
    }
}

export async function checkControllerHealth(): Promise<ServiceHealth> {
    const payload = await controllerRequest('/health', { timeoutMs: HEALTH_TIMEOUT_MS })
    return parseControllerHealth(payload) ? { state: 'connected' } : { state: 'unavailable' }
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
        body,
    })
    const result = applySchema.safeParse(payload)
    return result.success && result.data.activeRevision === snapshot.revision ? result.data : null
}
