import type { SendActionEmailInput, MailClient } from './Types/mail.types.ts'
import '@tanstack/react-start/server-only'

import { createTransport } from 'nodemailer'
import { connect, type Socket } from 'node:net'
import { createHash } from 'node:crypto'
import { NOTIFICATION_LIMITS } from '@/config/notifications.config.ts'
import type {
    NotificationPayload,
    NotificationDeliveryResult,
} from '@/lib/Notifications/Types/notifications.types.ts'
import type {
    NotificationMailClient,
    NotificationMailOptions,
} from './Types/notification-mail.types.ts'
import type { SmtpConfiguration } from './Types/smtp-options.types.ts'

import { getPublicOrigin, getSmtpConfiguration } from '@/server/env.server.ts'
import { createSmtpTransportOptions } from './smtp-options.ts'
import { createPasswordResetEmailTemplate, createUserInviteEmailTemplate } from './templates.ts'
import { createNotificationEmailTemplate } from './notification-template.ts'
import type { MailTemplate } from './Types/templates.types.ts'

let mailClient: MailClient | null = null

export function createNotificationMailClient(
    configuration: SmtpConfiguration,
): NotificationMailClient {
    let socket: Socket | undefined
    let closed = false
    const transport = createTransport({
        ...createSmtpTransportOptions(configuration),
        pool: true,
        maxConnections: 1,
        maxMessages: 1,
        maxRequeues: 0,
        connectionTimeout: NOTIFICATION_LIMITS.transportTimeoutMs,
        greetingTimeout: NOTIFICATION_LIMITS.transportTimeoutMs,
        socketTimeout: NOTIFICATION_LIMITS.transportTimeoutMs,
        logger: false,
        debug: false,
        getSocket(
            _options: unknown,
            callback: (error: Error | null, options?: { connection: Socket }) => void,
        ) {
            if (closed) {
                callback(new Error('cancelled'))
                return
            }
            // Retain the underlying TCP socket through STARTTLS/implicit TLS wrapping.
            // Pool.close() alone only gracefully stops active sends.
            socket = connect({ host: configuration.host, port: configuration.port })
            let completed = false
            const fail = () => {
                if (!completed) {
                    completed = true
                    callback(new Error('smtp_unavailable'))
                }
            }
            socket.once('error', fail)
            socket.once('close', fail)
            socket.once('connect', () => {
                if (completed) return
                completed = true
                socket?.removeListener('error', fail)
                socket?.removeListener('close', fail)
                if (closed) {
                    socket?.destroy()
                    callback(new Error('cancelled'))
                    return
                }
                callback(null, { connection: socket! })
            })
        },
    })
    return {
        from: configuration.from,
        sendMail: (options) => transport.sendMail(options),
        close() {
            closed = true
            socket?.destroy()
            transport.close()
        },
    }
}

export async function sendNotificationEmailService(
    recipients: readonly string[],
    payload: NotificationPayload,
    signal?: AbortSignal,
    options: NotificationMailOptions = {},
): Promise<NotificationDeliveryResult> {
    if (signal?.aborted) return { success: false, code: 'cancelled', retryable: false }
    const serializedPayload = JSON.stringify(payload, null, 2)
    if (Buffer.byteLength(serializedPayload) > NOTIFICATION_LIMITS.payloadBytes)
        return { success: false, code: 'payload_limit', retryable: false }
    const appUrl = getPublicOrigin()
    if (!appUrl) return { success: false, code: 'configuration_unavailable', retryable: false }
    let client: NotificationMailClient | null
    try {
        if (options.createClient) client = options.createClient()
        else {
            const configuration = getSmtpConfiguration()
            client = configuration
                ? createNotificationMailClient({
                      ...configuration,
                      user: configuration.user ?? null,
                      password: configuration.password ?? null,
                  })
                : null
        }
    } catch {
        return { success: false, code: 'smtp_unavailable', retryable: false }
    }
    if (!client) return { success: false, code: 'smtp_unavailable', retryable: false }
    const activeClient = client
    try {
        const content = createNotificationEmailTemplate(payload, {
            appUrl,
            appearance: options.appearance,
        })
        if (signal?.aborted) return { success: false, code: 'cancelled', retryable: false }
        return await new Promise<NotificationDeliveryResult>((resolve) => {
            let finished = false
            const finish = (result: NotificationDeliveryResult) => {
                if (finished) return
                finished = true
                clearTimeout(timer)
                signal?.removeEventListener('abort', cancel)
                resolve(result)
            }
            const cancel = () => finish({ success: false, code: 'cancelled', retryable: false })
            const timer = setTimeout(
                () => finish({ success: false, code: 'timeout', retryable: true }),
                Math.min(
                    options.timeoutMs ?? NOTIFICATION_LIMITS.transportTimeoutMs,
                    NOTIFICATION_LIMITS.transportTimeoutMs,
                ),
            )
            signal?.addEventListener('abort', cancel, { once: true })
            if (signal?.aborted) {
                cancel()
                return
            }
            void Promise.resolve()
                .then(() => {
                    if (finished) throw new Error('cancelled')
                    return activeClient.sendMail({
                        ...content,
                        disableFileAccess: true,
                        disableUrlAccess: true,
                        from: activeClient.from,
                        to: [...recipients],
                        messageId: `<${createHash('sha256').update(payload.id).digest('hex')}@notifications.rentnerproxy>`,
                    })
                })
                .then(
                    (result) => {
                        const missing =
                            result.rejected?.length ??
                            Math.max(0, recipients.length - (result.accepted?.length ?? 0))
                        const permanent =
                            result.rejectedErrors !== undefined &&
                            result.rejectedErrors.length > 0 &&
                            result.rejectedErrors.length >= missing &&
                            result.rejectedErrors.every(
                                (error) =>
                                    typeof error.responseCode === 'number' &&
                                    error.responseCode >= 500 &&
                                    error.responseCode < 600,
                            )
                        finish(
                            result.accepted?.length === recipients.length &&
                                !result.rejected?.length &&
                                !result.rejectedErrors?.length
                                ? { success: true }
                                : {
                                      success: false,
                                      code: 'smtp_unavailable',
                                      retryable: !permanent,
                                  },
                        )
                    },
                    () => finish({ success: false, code: 'smtp_unavailable', retryable: true }),
                )
        })
    } finally {
        activeClient.close()
    }
}

function getMailClient(): MailClient {
    if (mailClient) {
        return mailClient
    }

    const configuration = getSmtpConfiguration()

    if (!configuration) {
        throw new Error('SMTP is not configured.')
    }

    const transport = createTransport(
        createSmtpTransportOptions({
            ...configuration,
            user: configuration.user ?? null,
            password: configuration.password ?? null,
        }),
    )
    mailClient = {
        from: configuration.from,
        transport,
    }

    return mailClient
}

async function getRequiredPublicOrigin(): Promise<string> {
    const publicOrigin = getPublicOrigin()

    if (!publicOrigin) {
        throw new Error('PUBLIC_ORIGIN is not configured.')
    }

    return publicOrigin
}

async function sendMail(to: string, template: MailTemplate): Promise<void> {
    const client = getMailClient()

    await client.transport.sendMail({
        ...template,
        disableFileAccess: true,
        disableUrlAccess: true,
        from: client.from,
        to,
    })
}

export async function sendPasswordResetEmailService({
    to,
    displayName,
    token,
    appearance,
}: SendActionEmailInput): Promise<void> {
    const template = createPasswordResetEmailTemplate({
        appUrl: await getRequiredPublicOrigin(),
        displayName,
        token,
        appearance,
    })

    await sendMail(to, template)
}

export async function sendUserInviteEmailService({
    to,
    displayName,
    token,
    appearance,
}: SendActionEmailInput): Promise<void> {
    const template = createUserInviteEmailTemplate({
        appUrl: await getRequiredPublicOrigin(),
        displayName,
        token,
        appearance,
    })

    await sendMail(to, template)
}
