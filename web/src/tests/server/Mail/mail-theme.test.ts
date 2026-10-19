import { describe, expect, test } from 'bun:test'
import { createMailTheme } from '@/server/Mail/mail-theme.ts'
import { createTransport } from 'nodemailer'
import { createNotificationEmailTemplate } from '@/server/Mail/notification-template.ts'
import {
    createPasswordResetEmailTemplate,
    createUserInviteEmailTemplate,
} from '@/server/Mail/templates.ts'
import { accentContrastRatio } from '@/lib/Theme/accentPalette.ts'
import type { MailAppearance } from '@/server/Mail/Types/mail-theme.types.ts'
import { PAYLOAD } from '../Notifications/Types/transport-test.types.ts'

const action = { appUrl: 'https://proxy.example', displayName: 'Erika', token: 'mail-test-token' }

describe('personalized common mail design', () => {
    test.each(['light', 'dark'] as const)(
        'applies %s and custom accents to every kind of mail',
        (themeMode) => {
            const appearance: MailAppearance = { themeMode, accentColor: '#8844ee' }
            const theme = createMailTheme(appearance)
            const templates = [
                createPasswordResetEmailTemplate({ ...action, appearance }),
                createUserInviteEmailTemplate({ ...action, appearance }),
                createNotificationEmailTemplate(PAYLOAD, { appUrl: action.appUrl, appearance }),
                createNotificationEmailTemplate(
                    { ...PAYLOAD, type: 'recovery', code: 'operation_recovered' },
                    { appUrl: action.appUrl, appearance },
                ),
                createNotificationEmailTemplate(
                    {
                        ...PAYLOAD,
                        type: 'test',
                        code: 'notification_test',
                        severity: 'info',
                        failures: 0,
                    },
                    { appUrl: action.appUrl, appearance },
                ),
            ]
            for (const template of templates) {
                expect(template.html).toContain(`name="color-scheme" content="${themeMode}"`)
                expect(template.html).toContain(`background:${theme.canvas}`)
                expect(template.html).toContain(`background:${theme.surface}`)
                expect(template.html).toContain(`color:${theme.accentText}`)
                expect(template.html.match(/<img\b/gi)).toHaveLength(1)
                expect(template.html).toContain(`src="${action.appUrl}/media/mail-logo/8844ee?v=1"`)
                expect(template.html).not.toContain('#30ee61')
                expect(template.text).not.toContain('cid:')
            }
            expect(templates[0]?.html).toContain('background:#8844ee')
        },
    )

    test('preserves readable accents for very light and dark custom colors', () => {
        for (const themeMode of ['light', 'dark'] as const) {
            for (const accentColor of ['#000000', '#ffffff', '#080812', '#fffdc0', '#8844ee']) {
                const theme = createMailTheme({ themeMode, accentColor })
                expect(accentContrastRatio(theme.accentText, theme.surface)).toBeGreaterThanOrEqual(
                    4.5,
                )
                expect(
                    accentContrastRatio(theme.accentForeground, theme.accent),
                ).toBeGreaterThanOrEqual(4.5)
            }
        }
    })

    test('falls back safely when no preferences exist or an accent contains CSS', () => {
        const fallback = createMailTheme()
        expect(fallback.mode).toBe('light')
        expect(fallback.accent).toBe('#30ee61')
        const appearance: MailAppearance = {
            themeMode: 'dark',
            accentColor: '#fff; background:url(https://untrusted.example)',
        }
        const template = createPasswordResetEmailTemplate({ ...action, appearance })
        expect(createMailTheme(appearance).accent).toBe('#30ee61')
        expect(template.html).not.toContain('untrusted.example')
        expect(template.html).not.toMatch(/url\s*\(/i)
    })

    test('uses recipient-colored external logos and creates no image attachments in outgoing MIME', async () => {
        const green: MailAppearance = { themeMode: 'light', accentColor: '#30ee61' }
        const purple: MailAppearance = { themeMode: 'dark', accentColor: '#8844ee' }
        const first = createPasswordResetEmailTemplate({ ...action, appearance: green })
        const second = createNotificationEmailTemplate(PAYLOAD, {
            appUrl: action.appUrl,
            appearance: purple,
        })
        const third = createUserInviteEmailTemplate({ ...action, appearance: purple })
        const transport = createTransport({ streamTransport: true, buffer: true, newline: 'unix' })
        await Promise.all(
            [first, second, third].map(async (message) => {
                expect(message.html).toContain(`${action.appUrl}/media/mail-logo/`)
                expect(message.html).not.toContain('cid:')
                const result = await transport.sendMail({
                    ...message,
                    from: 'sender@example.test',
                    to: 'recipient@example.test',
                    disableFileAccess: true,
                    disableUrlAccess: true,
                })
                if (!Buffer.isBuffer(result.message))
                    throw new Error('Expected a local buffered MIME message.')
                const mime = result.message.toString('utf8')
                expect(mime).toContain('Content-Type: multipart/alternative;')
                expect(mime).not.toContain('Content-Type: multipart/related;')
                expect(mime).not.toContain('Content-Type: image/')
                expect(mime).not.toContain('Content-ID:')
                expect(mime).not.toContain('Content-Disposition:')
            }),
        )
        expect(first.html).toContain('/media/mail-logo/30ee61?v=1')
        expect(second.html).toContain('/media/mail-logo/8844ee?v=1')
        expect(third.html).toContain('/media/mail-logo/8844ee?v=1')
    })
})
