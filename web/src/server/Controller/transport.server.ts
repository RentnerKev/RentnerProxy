import type { ControllerRequestOptions } from './Types/transport.types.ts'
import '@tanstack/react-start/server-only'
import { z } from 'zod'
import { readBoundedStream } from '@/lib/Http/readBoundedStream.ts'

import {
    getControllerBaseUrl,
    getControllerToken,
    isLoopbackControllerUrl,
} from '@/server/env.server.ts'

const MAX_RESPONSE_BYTES = 4_096

async function readBoundedJson(
    response: Response,
    responseLimit = MAX_RESPONSE_BYTES,
    signal?: AbortSignal,
): Promise<unknown> {
    if (!response.body) return null
    const bytes = await readBoundedStream(response.body, responseLimit, signal)
    return JSON.parse(
        Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('utf8'),
    ) as unknown
}

export async function controllerRequest(
    path:
        | '/health'
        | '/ready'
        | '/internal/v1/diagnostics/domain'
        | '/internal/v1/proxy/status'
        | '/internal/v1/proxy/version'
        | '/internal/v1/crowdsec/status'
        | `/internal/v1/crowdsec/dashboard${string}`
        | '/internal/v1/crowdsec/config'
        | '/internal/v1/crowdsec/test'
        | '/internal/v1/crowdsec/console/enroll'
        | `/internal/v1/proxy/access-logs${string}`
        | '/internal/v1/proxy/config'
        | '/internal/v1/proxy/config/preview'
        | `/internal/v1/proxy/hosts/${string}/config`
        | `/internal/v1/proxy/hosts/${string}/config/preview`
        | '/internal/v1/certificates'
        | `/internal/v1/certificates/${string}`
        | `/internal/v1/certificates/events${string}`
        | '/internal/v1/trusted-cas/validate'
        | '/internal/v1/dns/connections'
        | '/internal/v1/dns/providers'
        | `/internal/v1/discovery/docker/${'status' | 'config' | 'inspect'}`
        | `/internal/v1/dns/connections/${string}`
        | `/internal/v1/ddns/${'status' | 'config' | 'preview' | 'enable' | 'disable' | 'sync'}`,
    options: ControllerRequestOptions,
): Promise<unknown> {
    if (options.signal?.aborted) return null
    const baseUrl = getControllerBaseUrl()
    const safePath = path.split('?')[0] ?? path
    if (!baseUrl) return null
    if (!isLoopbackControllerUrl(baseUrl) && !baseUrl.startsWith('https://')) return null

    const headers: Record<string, string> = { accept: 'application/json' }
    const isDnsConnectionRequest =
        path === '/internal/v1/dns/providers' ||
        path === '/internal/v1/dns/connections' ||
        path.startsWith('/internal/v1/dns/connections/')
    if (options.privileged || path.startsWith('/internal/')) {
        const token = getControllerToken()
        if (!token) return null
        headers.authorization = 'Bearer ' + token
    }

    if (options.body !== undefined) headers['content-type'] = 'application/json'
    const requestAbort = new AbortController()
    const abortFromCaller = () => requestAbort.abort()
    options.signal?.addEventListener('abort', abortFromCaller, { once: true })
    if (options.signal?.aborted) requestAbort.abort()
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
            void response.body?.cancel().catch(() => undefined)
            if (response.status === 404 && options.allowNotFound) return null
            console.warn('[controller] request unavailable', {
                path: safePath,
                status: response.status,
            })
            return null
        }

        const payload = await readBoundedJson(response, options.responseLimit, requestAbort.signal)
        if (response.ok) return payload
        if (options.acceptNonOkJson) return payload

        const errorSchema = z.object({ error: z.string().max(64) })
        const error = (isDnsConnectionRequest ? errorSchema.strict() : errorSchema).safeParse(
            payload,
        )
        return error.success ? error.data : null
    } catch {
        console.warn('[controller] request unavailable', { path: safePath })
        return null
    } finally {
        options.signal?.removeEventListener('abort', abortFromCaller)
        clearTimeout(timeout)
    }
}
