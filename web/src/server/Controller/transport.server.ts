import type { ControllerRequestOptions } from './Types/transport.types.ts'
// oxlint-disable no-await-in-loop -- Bounded response chunks must be read and cancelled in order.
import '@tanstack/react-start/server-only'
import { z } from 'zod'

import {
    getControllerBaseUrl,
    getControllerToken,
    isLoopbackControllerUrl,
} from '@/server/env.server.ts'

const MAX_RESPONSE_BYTES = 4_096

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
