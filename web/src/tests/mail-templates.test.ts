import { describe, expect, test } from 'bun:test'

import {
    createPasswordResetEmailTemplate,
    createUserInviteEmailTemplate,
} from '../server/Mail/templates'

const APP_URL = 'https://app.rentnerproxy.example'

describe('RentnerProxy mail templates', () => {
    test('escapes untrusted display names and token-derived links in HTML', () => {
        const template = createPasswordResetEmailTemplate({
            appUrl: APP_URL,
            displayName: '<Admin & "Team">',
            token: 'reset-token<&"',
        })

        expect(template.html).toContain('Hallo &lt;Admin &amp; &quot;Team&quot;&gt;,')
        expect(template.html).not.toContain('<Admin & "Team">')
        expect(template.html).not.toContain('reset-token<&"')
        expect(template.html).toContain('reset-token%3C%26%22')
    })

    test('keeps the password-reset text and HTML content semantically aligned', () => {
        const actionUrl = `${APP_URL}/reset-password#token=reset-token`
        const template = createPasswordResetEmailTemplate({
            appUrl: APP_URL,
            displayName: 'Erika Mustermann',
            token: 'reset-token',
        })

        for (const content of [template.text, template.html]) {
            expect(content).toContain('Passwort zurücksetzen')
            expect(content).toContain('Hallo Erika Mustermann,')
            expect(content).toContain(actionUrl)
            expect(content).toContain('Wenn du das nicht angefordert hast')
        }
    })

    test('keeps the invitation text and HTML content semantically aligned', () => {
        const actionUrl = `${APP_URL}/accept-invite#token=invite-token`
        const template = createUserInviteEmailTemplate({
            appUrl: APP_URL,
            displayName: 'Max Mustermann',
            token: 'invite-token',
        })

        for (const content of [template.text, template.html]) {
            expect(content).toContain('Einladung zu RentnerProxy')
            expect(content).toContain('Hallo Max Mustermann,')
            expect(content).toContain(actionUrl)
            expect(content).toContain('Wenn du diese Einladung nicht erwartest')
        }
    })

    test('uses only the configured APP_URL and puts tokens in URL fragments', () => {
        const configuredAppUrl = 'https://configured.rentnerproxy.example/base?ignored=true#old'
        const template = createPasswordResetEmailTemplate({
            appUrl: configuredAppUrl,
            displayName: 'Erika',
            token: 'fragment-token',
        })
        const expectedActionUrl =
            'https://configured.rentnerproxy.example/reset-password#token=fragment-token'

        expect(template.text).toContain(expectedActionUrl)
        expect(template.html).toContain(expectedActionUrl)
        expect(template.text).not.toContain('?token=')
        expect(template.html).not.toContain('?token=')
        expect(template.text).not.toContain('localhost')
        expect(template.html).not.toContain('localhost')
        expect(template.text).not.toContain('host-header')
        expect(template.html).not.toContain('host-header')
    })

    test('contains no trackers, scripts, or external assets', () => {
        const template = createUserInviteEmailTemplate({
            appUrl: APP_URL,
            displayName: 'Erika',
            token: 'invite-token',
        })

        expect(template.html).not.toMatch(/<img\b/i)
        expect(template.html).not.toMatch(/<script\b/i)
        expect(template.html).not.toMatch(/<link\b/i)
        expect(template.html).not.toMatch(/@import|url\s*\(/i)

        const expectedOrigin = new URL(APP_URL).origin
        const embeddedUrls = template.html.match(/https?:\/\/[^\s"'<]+/g) ?? []

        expect(embeddedUrls.length).toBeGreaterThan(0)
        expect(embeddedUrls.every((url) => new URL(url).origin === expectedOrigin)).toBe(true)
    })
})
