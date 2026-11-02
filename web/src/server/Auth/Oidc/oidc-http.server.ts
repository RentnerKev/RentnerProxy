import '@tanstack/react-start/server-only'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { checkServerIdentity } from 'node:tls'
import type { CustomFetch } from 'openid-client'
import { OIDC_LIMITS } from '@/config/oidc.config.ts'
import { createWebhookSystemResolver } from '@/server/Notifications/webhook-delivery.ts'
import {
    isWebhookAddressAllowed,
    parseWebhookDestination,
} from '@/server/Notifications/webhook-policy.ts'
import type { OidcClientConfiguration } from './Types/oidc.types.ts'
import type { OidcHttpOptions } from './Types/oidc-client.types.ts'
import { OidcDomainError } from './oidc.errors.ts'

const systemResolve = createWebhookSystemResolver()

/** Restricts backchannel destinations to explicitly configured HTTPS origins and network policy. */
export function validateOidcEndpoint(value: string, configuration: OidcClientConfiguration): URL {
    try {
        const url = parseWebhookDestination({
            kind: 'webhook',
            url: value,
            authorizationToken: null,
            allowedPrivateCidrs: [...configuration.allowedPrivateCidrs],
        })
        if (
            url.protocol !== 'https:' ||
            url.search ||
            !configuration.allowedEndpointOrigins.includes(url.origin)
        )
            throw new Error()
        return url
    } catch {
        throw new OidcDomainError('provider_unavailable')
    }
}

/** Pins each bounded HTTPS request to checked DNS answers while retaining the original TLS identity. */
export function createOidcHttpFetch(
    configuration: OidcClientConfiguration,
    options: OidcHttpOptions = {},
): CustomFetch {
    return async (input, init) => {
        const url = validateOidcEndpoint(input, configuration)
        const controller = new AbortController()
        const cancel = () => controller.abort()
        init.signal?.addEventListener('abort', cancel, { once: true })
        if (init.signal?.aborted) cancel()
        const timer = setTimeout(
            cancel,
            Math.min(
                options.timeoutMs ?? OIDC_LIMITS.requestTimeoutMs,
                OIDC_LIMITS.requestTimeoutMs,
            ),
        )
        try {
            if (!['GET', 'POST'].includes(init.method)) throw new Error()
            const body =
                init.body == null
                    ? undefined
                    : typeof init.body === 'string'
                      ? init.body
                      : init.body instanceof URLSearchParams
                        ? init.body.toString()
                        : undefined
            if (
                (init.body != null && body === undefined) ||
                (body && Buffer.byteLength(body) > OIDC_LIMITS.responseBytes)
            )
                throw new Error()
            const hostname = url.hostname.replace(/^\[|\]$/g, '')
            const addresses = await new Promise<readonly string[]>((resolve, reject) => {
                const abort = () => {
                    controller.signal.removeEventListener('abort', abort)
                    reject(new Error())
                }
                controller.signal.addEventListener('abort', abort, { once: true })
                if (controller.signal.aborted) {
                    abort()
                    return
                }
                void Promise.resolve()
                    .then(() =>
                        isIP(hostname)
                            ? [hostname]
                            : (options.resolve ?? systemResolve)(hostname, controller.signal),
                    )
                    .then(
                        (result) => {
                            controller.signal.removeEventListener('abort', abort)
                            resolve(result)
                        },
                        () => {
                            controller.signal.removeEventListener('abort', abort)
                            reject(new Error())
                        },
                    )
            })
            const destination = {
                kind: 'webhook' as const,
                url: url.href,
                authorizationToken: null,
                allowedPrivateCidrs: [...configuration.allowedPrivateCidrs],
            }
            if (
                controller.signal.aborted ||
                !addresses.length ||
                addresses.length > OIDC_LIMITS.dnsAnswers ||
                addresses.some((address) => !isWebhookAddressAllowed(address, destination))
            )
                throw new Error()
            return await new Promise<Response>((resolve, reject) => {
                const request = (options.request ?? httpsRequest)(
                    {
                        protocol: 'https:',
                        hostname: addresses[0]!,
                        family: isIP(addresses[0]!),
                        port: url.port || undefined,
                        path: url.pathname,
                        method: init.method,
                        agent: false,
                        servername: isIP(hostname) ? '' : hostname,
                        rejectUnauthorized: true,
                        checkServerIdentity: (_name, certificate) =>
                            checkServerIdentity(hostname, certificate),
                        maxHeaderSize: OIDC_LIMITS.responseHeaderBytes,
                        headers: {
                            ...init.headers,
                            Host: url.host,
                            ...(body === undefined
                                ? {}
                                : { 'Content-Length': Buffer.byteLength(body) }),
                        },
                        signal: controller.signal,
                    },
                    (response) => {
                        const fail = () => {
                            response.destroy()
                            request.destroy()
                            reject(new Error())
                        }
                        const status = response.statusCode ?? 0
                        response.on('error', fail)
                        response.on('aborted', fail)
                        if (
                            status < 200 ||
                            status >= 300 ||
                            (response.headers['content-encoding'] &&
                                response.headers['content-encoding'] !== 'identity') ||
                            Number(response.headers['content-length'] ?? 0) >
                                OIDC_LIMITS.responseBytes
                        ) {
                            fail()
                            return
                        }
                        const chunks: Buffer[] = []
                        let bytes = 0
                        response.on('data', (chunk: Buffer) => {
                            bytes += chunk.length
                            if (bytes > OIDC_LIMITS.responseBytes) fail()
                            else chunks.push(Buffer.from(chunk))
                        })
                        response.on('end', () => {
                            if (controller.signal.aborted || bytes > OIDC_LIMITS.responseBytes) {
                                fail()
                                return
                            }
                            const headers = new Headers()
                            for (const [name, value] of Object.entries(response.headers))
                                if (typeof value === 'string') headers.set(name, value)
                            try {
                                resolve(new Response(Buffer.concat(chunks), { status, headers }))
                            } catch {
                                fail()
                            }
                        })
                    },
                )
                request.on('error', () => reject(new Error()))
                request.end(body)
            })
        } catch {
            throw new OidcDomainError('provider_unavailable')
        } finally {
            clearTimeout(timer)
            init.signal?.removeEventListener('abort', cancel)
        }
    }
}
