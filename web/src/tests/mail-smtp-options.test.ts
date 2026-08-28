import { describe, expect, test } from 'bun:test'

import { createSmtpTransportOptions } from '../server/Mail/smtp-options'

const BASE_CONFIGURATION = {
    host: 'smtp.rentnerproxy.example',
    port: 587,
    secure: false,
    user: 'mailer',
    password: 'test-password',
    from: 'RentnerProxy <no-reply@rentnerproxy.example>',
} as const

describe('RentnerProxy SMTP transport options', () => {
    test('requires STARTTLS and blocks file and URL access', () => {
        expect(createSmtpTransportOptions(BASE_CONFIGURATION)).toEqual({
            host: 'smtp.rentnerproxy.example',
            port: 587,
            secure: false,
            requireTLS: true,
            connectionTimeout: 10_000,
            greetingTimeout: 10_000,
            socketTimeout: 30_000,
            disableFileAccess: true,
            disableUrlAccess: true,
            tls: {
                minVersion: 'TLSv1.2',
            },
            auth: {
                user: 'mailer',
                pass: 'test-password',
            },
        })
    })

    test('supports implicit TLS without inventing SMTP authentication', () => {
        const options = createSmtpTransportOptions({
            ...BASE_CONFIGURATION,
            port: 465,
            secure: true,
            user: null,
            password: null,
        })

        expect(options).toMatchObject({
            secure: true,
            requireTLS: false,
            disableFileAccess: true,
            disableUrlAccess: true,
        })
        expect(options).not.toHaveProperty('auth')
    })

    test('rejects partial SMTP credentials without exposing their values', () => {
        expect(() =>
            createSmtpTransportOptions({
                ...BASE_CONFIGURATION,
                password: null,
            }),
        ).toThrow('SMTP credentials must be configured together.')
    })
})
