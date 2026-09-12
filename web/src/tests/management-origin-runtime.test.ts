import { expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'

test('mail and passkeys use deployment configuration without consulting legacy database settings', async () => {
    const child = Bun.spawn(
        [
            process.execPath,
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
        process.env.RENTNERPROXY_PUBLIC_ORIGIN = 'https://management.example.com:8443/'
        process.env.APP_URL = 'https://retired.example.com'
        process.env.WEBAUTHN_RP_ID = 'retired.example.com'
        process.env.SMTP_HOST = 'smtp.example.com'
        process.env.SMTP_PORT = '25'
        process.env.SMTP_SECURE = 'false'
        process.env.SMTP_FROM = 'test@example.com'
        delete process.env.SMTP_USER
        delete process.env.SMTP_PASSWORD
        const { getRuntimeWebAuthnConfiguration, getRuntimeManagementOrigin } = await import('./server/Configuration/management-origin.server.ts')
        const { sendPasswordResetEmailService, sendUserInviteEmailService } = await import('./server/Mail/mail.service.ts')
        const input = { to: 'recipient@example.com', displayName: 'Test', token: 'isolated-token' }
        await sendPasswordResetEmailService(input)
        await sendUserInviteEmailService(input)
        const passkeys = await getRuntimeWebAuthnConfiguration()
        delete process.env.RENTNERPROXY_PUBLIC_ORIGIN
        if (await getRuntimeManagementOrigin() !== null) throw Error('Missing origin used a fallback')
        let rejected = false
        try { await sendPasswordResetEmailService(input) } catch (error) {
            rejected = error.message.includes('RENTNERPROXY_PUBLIC_ORIGIN')
        }
        if (!rejected || sent.length !== 2) throw Error('Invalid deployment sent mail')
        console.log(JSON.stringify({ sent, passkeys }))
    `,
        ],
        { cwd: fileURLToPath(new URL('../', import.meta.url)), stdout: 'pipe', stderr: 'pipe' },
    )
    const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ])
    expect(code, stderr).toBe(0)
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
})
