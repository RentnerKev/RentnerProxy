import { Resolver } from 'node:dns/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { checkServerIdentity } from 'node:tls'
import { NOTIFICATION_LIMITS } from '@/config/notifications.config.ts'
import type {
    NotificationDeliveryResult,
    NotificationPayload,
} from '@/lib/Notifications/Types/notifications.types.ts'
import type {
    WebhookDeliveryOptions,
    WebhookDestination,
    WebhookResolver,
} from './Types/transport.types.ts'
import { isWebhookAddressAllowed, parseWebhookDestination } from './webhook-policy.ts'

const resolveAddresses: WebhookResolver = async (hostname, signal) => {
    const resolver = new Resolver({ timeout: NOTIFICATION_LIMITS.dnsTimeoutMs, tries: 1 })
    const cancel = () => resolver.cancel()
    signal.addEventListener('abort', cancel, { once: true })
    try {
        signal.throwIfAborted()
        const results = await Promise.allSettled([
            resolver.resolve4(hostname),
            resolver.resolve6(hostname),
        ])
        const addresses: string[] = []
        for (const result of results) {
            if (result.status === 'fulfilled') addresses.push(...result.value)
            else {
                const code =
                    result.reason && typeof result.reason === 'object' && 'code' in result.reason
                        ? result.reason.code
                        : null
                if (code !== 'ENODATA' && code !== 'ENOTFOUND')
                    throw new Error('destination_unavailable')
            }
        }
        return addresses
    } finally {
        signal.removeEventListener('abort', cancel)
    }
}

export async function deliverWebhookNotification(
    destination: WebhookDestination,
    payload: NotificationPayload,
    signal?: AbortSignal,
    options: WebhookDeliveryOptions = {},
): Promise<NotificationDeliveryResult> {
    if (signal?.aborted) return { success: false, code: 'cancelled', retryable: false }
    let url: URL
    try {
        url = parseWebhookDestination(destination)
    } catch {
        return { success: false, code: 'destination_blocked', retryable: false }
    }
    const body = JSON.stringify(payload)
    if (Buffer.byteLength(body) > NOTIFICATION_LIMITS.payloadBytes)
        return { success: false, code: 'payload_limit', retryable: false }
    const controller = new AbortController()
    const cancel = () => controller.abort()
    signal?.addEventListener('abort', cancel, { once: true })
    const timer = setTimeout(
        cancel,
        Math.min(
            options.timeoutMs ?? NOTIFICATION_LIMITS.transportTimeoutMs,
            NOTIFICATION_LIMITS.transportTimeoutMs,
        ),
    )
    let dnsTimer: ReturnType<typeof setTimeout> | undefined
    try {
        const hostname = url.hostname.replace(/^\[|\]$/g, '')
        let addresses: readonly string[]
        if (isIP(hostname)) addresses = [hostname]
        else {
            dnsTimer = setTimeout(
                cancel,
                Math.min(
                    options.dnsTimeoutMs ?? NOTIFICATION_LIMITS.dnsTimeoutMs,
                    NOTIFICATION_LIMITS.dnsTimeoutMs,
                ),
            )
            addresses = await (options.resolve ?? resolveAddresses)(hostname, controller.signal)
            clearTimeout(dnsTimer)
        }
        if (controller.signal.aborted) throw new Error('timeout')
        if (!addresses.length)
            return { success: false, code: 'destination_unavailable', retryable: true }
        if (addresses.some((address) => !isWebhookAddressAllowed(address, destination)))
            return { success: false, code: 'destination_blocked', retryable: false }
        return await new Promise<NotificationDeliveryResult>((resolve) => {
            const request = (
                options.request ?? (url.protocol === 'https:' ? httpsRequest : httpRequest)
            )(
                {
                    protocol: url.protocol,
                    hostname: addresses[0]!,
                    family: isIP(addresses[0]!),
                    port: url.port || undefined,
                    path: url.pathname + url.search,
                    method: 'POST',
                    agent: false,
                    ...(url.protocol === 'https:'
                        ? {
                              servername: isIP(hostname) ? '' : hostname,
                              rejectUnauthorized: true,
                              checkServerIdentity: (
                                  _hostname: string,
                                  certificate: Parameters<typeof checkServerIdentity>[1],
                              ) => checkServerIdentity(hostname, certificate),
                          }
                        : {}),
                    maxHeaderSize: 8_192,
                    headers: {
                        Host: url.host,
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(body),
                        'X-RentnerProxy-Event-Id': payload.id,
                        'Idempotency-Key': payload.id,
                        ...(destination.authorizationToken === null
                            ? {}
                            : { Authorization: `Bearer ${destination.authorizationToken}` }),
                    },
                    signal: controller.signal,
                },
                (response) => {
                    const status = response.statusCode ?? 0
                    const retryAfter = response.headers['retry-after']
                    response.on('error', () => {})
                    response.destroy()
                    request.destroy()
                    if (status >= 200 && status < 300) return resolve({ success: true })
                    if (status >= 300 && status < 400)
                        return resolve({
                            success: false,
                            code: 'redirect_denied',
                            retryable: false,
                        })
                    const retryable = status === 408 || status === 429 || status >= 500
                    resolve({
                        success: false,
                        code: 'http_rejected',
                        retryable,
                        ...(retryable &&
                        typeof retryAfter === 'string' &&
                        /^\d{1,8}$/.test(retryAfter)
                            ? {
                                  retryAfterMs: Math.min(
                                      Number(retryAfter) * 1_000,
                                      NOTIFICATION_LIMITS.retryMaximumMs,
                                  ),
                              }
                            : {}),
                    })
                },
            )
            request.on('error', () =>
                resolve({
                    success: false,
                    code: signal?.aborted
                        ? 'cancelled'
                        : controller.signal.aborted
                          ? 'timeout'
                          : 'destination_unavailable',
                    retryable: !signal?.aborted,
                }),
            )
            request.end(body)
        })
    } catch {
        return {
            success: false,
            code: signal?.aborted
                ? 'cancelled'
                : controller.signal.aborted
                  ? 'timeout'
                  : 'destination_unavailable',
            retryable: !signal?.aborted,
        }
    } finally {
        clearTimeout(timer)
        clearTimeout(dnsTimer)
        signal?.removeEventListener('abort', cancel)
    }
}
