import { expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'

test.each(['new', 'legacy', 'both'])(
    'mail and passkeys use %s deployment configuration without consulting legacy database settings',
    async (configuration) => {
        const child = Bun.spawn(
            [
                process.execPath,
                '--no-env-file',
                '-e',
                `
        import { mock } from 'bun:test'
        const sent = []
        mock.module('nodemailer', () => ({
            createTransport: () => ({ sendMail: async message => { sent.push(message) } }),
        }))
        mock.module('./server/Auth/Core/database.server.ts', () => ({
            getAuthDatabase: () => { throw Error('Legacy origin database must not be consulted') },
        }))
        process.env.NODE_ENV = 'production'
        delete process.env.PUBLIC_ORIGIN
        delete process.env.RENTNERPROXY_PUBLIC_ORIGIN
        if ('${configuration}' === 'legacy') {
            process.env.RENTNERPROXY_PUBLIC_ORIGIN = 'https://management.example.com:8443/'
        } else {
            process.env.PUBLIC_ORIGIN = 'https://management.example.com:8443/'
            if ('${configuration}' === 'both') process.env.RENTNERPROXY_PUBLIC_ORIGIN = 'https://legacy.example.com'
        }
        process.env.APP_URL = 'https://retired.example.com'
        process.env.WEBAUTHN_RP_ID = 'retired.example.com'
        process.env.SMTP_HOST = 'smtp.example.com'
        process.env.SMTP_PORT = '25'
        process.env.SMTP_SECURE = 'false'
        process.env.SMTP_FROM = 'test@example.com'
        delete process.env.SMTP_USER
        delete process.env.SMTP_PASSWORD
        const { getRuntimeWebAuthnConfiguration } = await import('./server/Configuration/management-origin.server.ts')
        const { getPublicOrigin } = await import('./server/env.server.ts')
        const { sendPasswordResetEmailService, sendUserInviteEmailService } = await import('./server/Mail/mail.service.ts')
        const input = { to: 'recipient@example.com', displayName: 'Test', token: 'isolated-token' }
        await sendPasswordResetEmailService(input)
        await sendUserInviteEmailService(input)
        const passkeys = await getRuntimeWebAuthnConfiguration()
        delete process.env.PUBLIC_ORIGIN
        delete process.env.RENTNERPROXY_PUBLIC_ORIGIN
        if (getPublicOrigin() !== null) throw Error('Missing origin used a fallback')
        let rejected = false
        try { await sendPasswordResetEmailService(input) } catch (error) {
            rejected = error.message.includes('PUBLIC_ORIGIN')
        }
        if (!rejected || sent.length !== 2) throw Error('Invalid deployment sent mail')
        console.log(JSON.stringify({ sent, passkeys }))
    `,
            ],
            {
                cwd: fileURLToPath(new URL('../../..', import.meta.url)),
                stdout: 'pipe',
                stderr: 'pipe',
            },
        )
        const [stdout, stderr, code] = await Promise.all([
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
            child.exited,
        ])
        expect(code, stderr).toBe(0)
        if (configuration === 'new') {
            expect(stderr).not.toContain('is deprecated')
        } else {
            expect(stderr).toContain('RENTNERPROXY_PUBLIC_ORIGIN is deprecated')
            expect(stderr).toContain('Please rename it to PUBLIC_ORIGIN')
            expect(stderr.match(/is deprecated/gu)).toHaveLength(1)
            expect(stderr).not.toContain('legacy.example.com')
        }
        const result = JSON.parse(stdout) as {
            sent: Array<{ text: string; html: string }>
            passkeys: { origin: string; rpId: string }
        }
        expect(result.passkeys).toMatchObject({
            origin: 'https://management.example.com:8443',
            rpId: 'management.example.com',
        })
        for (const [index, path] of ['reset-password', 'accept-invite'].entries()) {
            for (const content of [result.sent[index]!.text, result.sent[index]!.html]) {
                expect(content).toContain(
                    `https://management.example.com:8443/${path}#token=isolated-token`,
                )
                expect(content).not.toContain('retired.example.com')
            }
        }
    },
)
