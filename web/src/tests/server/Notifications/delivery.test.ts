import { describe, expect, test } from 'bun:test'
import {
    deliverNotification,
    validateNotificationDestination,
} from '@/server/Notifications/delivery.service.ts'
import {
    sendNotificationEmailService,
    createNotificationMailClient,
} from '@/server/Mail/mail.service.ts'
import { createServer } from 'node:net'
import type { SendMailOptions } from 'nodemailer'
import { PAYLOAD } from './Types/transport-test.types.ts'

describe('notification delivery', () => {
    test('validates recipients and never exposes destination exceptions', async () => {
        await Promise.all(
            [[], ['A <a@example.com>'], ['a@example.com\r\nBcc:b@example.com']].map(
                async (recipients) => {
                    expect(() =>
                        validateNotificationDestination({ kind: 'email', recipients }),
                    ).toThrow('destination_blocked')
                    expect(
                        await deliverNotification({ kind: 'email', recipients }, PAYLOAD),
                    ).toEqual({
                        success: false,
                        code: 'destination_blocked',
                        retryable: false,
                    })
                },
            ),
        )
    })
    test('SMTP rejects missing configuration and rejected or missing recipient results', async () => {
        expect(
            await sendNotificationEmailService(['a@example.com'], PAYLOAD, undefined, {
                createClient: () => null,
            }),
        ).toEqual({ success: false, code: 'smtp_unavailable', retryable: false })
        await Promise.all(
            [{ accepted: [], rejected: ['a@example.com'] }, { accepted: [] }].map(
                async (result) => {
                    expect(
                        await sendNotificationEmailService(['a@example.com'], PAYLOAD, undefined, {
                            createClient: () => ({
                                from: 'test@example.com',
                                close() {},
                                sendMail: async () => result,
                            }),
                        }),
                    ).toEqual({ success: false, code: 'smtp_unavailable', retryable: true })
                },
            ),
        )
    })
    test.each([
        { responseCode: 450, retryable: true },
        { responseCode: 550, retryable: false },
        { responseCode: undefined, retryable: true },
    ])(
        'SMTP partial acceptance retries only transient or unknown recipient failures',
        async ({ responseCode, retryable }) => {
            const result = await sendNotificationEmailService(
                ['a@example.com', 'b@example.com'],
                PAYLOAD,
                undefined,
                {
                    createClient: () => ({
                        from: 'test@example.com',
                        close() {},
                        sendMail: async () => ({
                            accepted: ['a@example.com'],
                            rejected: ['b@example.com'],
                            rejectedErrors: [{ responseCode }],
                        }),
                    }),
                },
            )
            expect(result).toEqual({ success: false, code: 'smtp_unavailable', retryable })
            expect(JSON.stringify(result)).not.toContain('example.com')
        },
    )
    test('SMTP escapes HTML, disables resource access and uses stable Message-ID', async () => {
        const sent: SendMailOptions[] = []
        let closed = 0
        const options = {
            createClient: () => ({
                from: 'test@example.com',
                close() {
                    closed++
                },
                sendMail: async (message: SendMailOptions) => {
                    sent.push(message)
                    return { accepted: ['a@example.com'], rejected: [] }
                },
            }),
        }
        await Promise.all(
            [0, 1].map(async () => {
                expect(
                    await sendNotificationEmailService(
                        ['a@example.com'],
                        { ...PAYLOAD, resourceId: '<img src="file:///private">' },
                        undefined,
                        options,
                    ),
                ).toEqual({ success: true })
            }),
        )
        expect(closed).toBe(2)
        expect(sent[0]?.html).toContain('&lt;img')
        expect(sent[0]?.html).not.toContain('<img src="file:///private">')
        expect(sent[0]?.html).toContain('src="cid:rentnerproxy-logo"')
        expect(sent[0]?.attachments).toHaveLength(1)
        expect(sent[0]?.attachments?.[0]?.cid).toBe('rentnerproxy-logo')
        expect(Buffer.isBuffer(sent[0]?.attachments?.[0]?.content)).toBe(true)
        expect(sent[0]?.subject).toBe('RentnerProxy: DDNS-Aktualisierung fehlgeschlagen')
        expect(sent[0]?.text).toContain('Ressourcen-ID: <img src="file:///private">')
        expect(sent[0]?.html).not.toContain('<pre>')
        expect(sent[0]?.disableFileAccess).toBe(true)
        expect(sent[0]?.disableUrlAccess).toBe(true)
        expect(sent[0]?.messageId).toBe(sent[1]?.messageId)
    })
    test('SMTP closes a pending transport on deadline and cancellation', async () => {
        let closed = 0
        const options = {
            timeoutMs: 30,
            createClient: () => ({
                from: 'test@example.com',
                close() {
                    closed++
                },
                sendMail: () => new Promise<{}>(() => {}),
            }),
        }
        expect(
            await sendNotificationEmailService(['a@example.com'], PAYLOAD, undefined, options),
        ).toEqual({ success: false, code: 'timeout', retryable: true })
        const controller = new AbortController()
        const result = sendNotificationEmailService(['a@example.com'], PAYLOAD, controller.signal, {
            ...options,
            timeoutMs: 1_000,
        })
        controller.abort()
        expect(await result).toEqual({ success: false, code: 'cancelled', retryable: false })
        expect(closed).toBe(2)
    })
    test.each([false, true])(
        'real SMTP connection (implicit TLS: %s) is destroyed on deadline',
        async (secure) => {
            let connected = false
            let closed = false
            const server = createServer((socket) => {
                connected = true
                socket.on('end', () => {
                    closed = true
                })
                socket.resume()
            })
            await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
            const address = server.address()
            if (!address || typeof address === 'string') throw new Error('fixture')
            try {
                const configuration = {
                    host: '127.0.0.1',
                    port: address.port,
                    secure,
                    from: 'test@example.com',
                    user: null,
                    password: null,
                }
                expect(
                    await sendNotificationEmailService(['a@example.com'], PAYLOAD, undefined, {
                        timeoutMs: 100,
                        createClient: () => createNotificationMailClient(configuration),
                    }),
                ).toEqual({ success: false, code: 'timeout', retryable: true })
                await new Promise((resolve) => setTimeout(resolve, 30))
                expect(connected).toBe(true)
                expect(closed).toBe(true)
            } finally {
                server.close()
            }
        },
    )
})
