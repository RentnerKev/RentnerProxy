import { describe, expect, test } from 'bun:test'
import { createMailTheme } from '@/server/Mail/mail-theme.ts'
import { createMailMessage } from '@/server/Mail/mail-message.ts'
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
                createNotificationEmailTemplate(PAYLOAD, appearance),
                createNotificationEmailTemplate(
                    { ...PAYLOAD, type: 'recovery', code: 'operation_recovered' },
                    appearance,
                ),
                createNotificationEmailTemplate(
                    {
                        ...PAYLOAD,
                        type: 'test',
                        code: 'notification_test',
                        severity: 'info',
                        failures: 0,
                    },
                    appearance,
                ),
            ]
            for (const template of templates) {
                expect(template.html).toContain(`name="color-scheme" content="${themeMode}"`)
                expect(template.html).toContain(`background:${theme.canvas}`)
                expect(template.html).toContain(`background:${theme.surface}`)
                expect(template.html).toContain(`color:${theme.accentText}`)
                expect(template.html.match(/<img\b/gi)).toHaveLength(1)
                expect(template.html).toContain('src="cid:rentnerproxy-logo"')
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

    test('embeds the chosen logo in every outgoing message without cross-user color reuse', async () => {
        const green: MailAppearance = { themeMode: 'light', accentColor: '#30ee61' }
        const purple: MailAppearance = { themeMode: 'dark', accentColor: '#8844ee' }
        const first = await createMailMessage(
            createPasswordResetEmailTemplate({ ...action, appearance: green }),
            green,
        )
        const second = await createMailMessage(
            createNotificationEmailTemplate(PAYLOAD, purple),
            purple,
        )
        const third = await createMailMessage(
            createUserInviteEmailTemplate({ ...action, appearance: purple }),
            purple,
        )
        for (const message of [first, second, third]) {
            expect(message.attachments).toHaveLength(1)
            const logo = message.attachments[0]!
            expect(message.html).toContain(`src="cid:${logo.cid}"`)
            expect(logo.contentType).toBe('image/png')
            expect(logo.contentDisposition).toBe('inline')
            expect(Buffer.isBuffer(logo.content)).toBe(true)
            expect(message.disableFileAccess).toBe(true)
            expect(message.disableUrlAccess).toBe(true)
        }
        expect(second.attachments[0]?.content).toEqual(third.attachments[0]?.content)
        expect(first.attachments[0]?.content).not.toEqual(second.attachments[0]?.content)
    })
})
