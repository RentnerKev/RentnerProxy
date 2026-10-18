import { lookup } from 'node:dns/promises'
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
    WebhookSystemLookup,
} from './Types/transport.types.ts'
import { isWebhookAddressAllowed, parseWebhookDestination } from './webhook-policy.ts'

export function createWebhookSystemResolver(
    systemLookup: WebhookSystemLookup = async (hostname) =>
        (await lookup(hostname, { all: true, verbatim: true })).map((answer) => answer.address),
): WebhookResolver {
    // getaddrinfo/NSS cannot be cancelled. Keep at most one OS lookup per host,
    // bounded across hosts, and remove cancelled subscribers independently.
    const pending = new Map<string, Set<(addresses: readonly string[] | null) => void>>()
    return (hostname, signal) => {
        signal.throwIfAborted()
        let subscribers = pending.get(hostname)
        if (!subscribers) {
            if (pending.size >= NOTIFICATION_LIMITS.channels)
                return Promise.reject(new Error('destination_unavailable'))
            subscribers = new Set()
            pending.set(hostname, subscribers)
            const activeSubscribers = subscribers
            const complete = (addresses: readonly string[] | null) => {
                pending.delete(hostname)
                for (const subscriber of activeSubscribers) subscriber(addresses)
                activeSubscribers.clear()
            }
            void Promise.resolve()
                .then(() => (activeSubscribers.size === 0 ? null : systemLookup(hostname)))
                .then(complete, () => complete(null))
        }
        const activeSubscribers = subscribers
        return new Promise((resolve, reject) => {
            const cancel = () => {
                activeSubscribers.delete(complete)
                signal.removeEventListener('abort', cancel)
                reject(new Error('cancelled'))
            }
            const complete = (addresses: readonly string[] | null) => {
                activeSubscribers.delete(complete)
                signal.removeEventListener('abort', cancel)
                if (addresses === null) reject(new Error('destination_unavailable'))
                else resolve(addresses)
            }
            activeSubscribers.add(complete)
            signal.addEventListener('abort', cancel, { once: true })
            if (signal.aborted) cancel()
        })
    }
}

const resolveAddresses = createWebhookSystemResolver()

function resolveBeforeAbort(
    resolver: WebhookResolver,
    hostname: string,
    signal: AbortSignal,
): Promise<readonly string[]> {
    return new Promise((resolve, reject) => {
        const cancel = () => {
            signal.removeEventListener('abort', cancel)
            reject(new Error('cancelled'))
        }
        const complete = (addresses: readonly string[]) => {
            signal.removeEventListener('abort', cancel)
            resolve(addresses)
        }
        const fail = () => {
            signal.removeEventListener('abort', cancel)
            reject(new Error('destination_unavailable'))
        }
        signal.addEventListener('abort', cancel, { once: true })
        if (signal.aborted) {
            cancel()
            return
        }
        // A custom resolver may ignore cancellation; its late result cannot resume
        // the delivery after this independent deadline facade has rejected.
        void Promise.resolve()
            .then(() => {
                signal.throwIfAborted()
                return resolver(hostname, signal)
            })
            .then(complete, fail)
    })
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
            addresses = await resolveBeforeAbort(
                options.resolve ?? resolveAddresses,
                hostname,
                controller.signal,
            )
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
