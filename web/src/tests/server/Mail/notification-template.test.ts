import { describe, expect, test } from 'bun:test'
import { createNotificationEmailTemplate } from '@/server/Mail/notification-template.ts'
import { PAYLOAD } from '../Notifications/Types/transport-test.types.ts'

const options = { appUrl: 'https://proxy.example' }

describe('notification email templates', () => {
    test.each([
        { category: 'ddns', heading: 'DDNS-Aktualisierung fehlgeschlagen' },
        { category: 'certificate_renewal', heading: 'Zertifikat nicht erneuert' },
        { category: 'proxy_configuration', heading: 'Proxy-Konfiguration nicht übernommen' },
    ] as const)('explains $category incidents in HTML and plain text', ({ category, heading }) => {
        const template = createNotificationEmailTemplate({ ...PAYLOAD, category }, options)

        expect(template.subject).toBe(`RentnerProxy: ${heading}`)
        for (const body of [template.html, template.text]) {
            expect(body).toContain(heading)
            expect(body).toContain(PAYLOAD.resourceId)
            expect(body).toContain('12:00:00 UTC')
            expect(body).toContain('Fehlversuche')
            expect(body).not.toContain('"schemaVersion"')
            expect(body).not.toContain('ddns_update_failed')
        }
        expect(template.html).not.toContain('<pre>')
        expect(template.text).toContain('Fehlversuche: 2')
    })

    test('presents recovery as resolved even when the incident had error severity', () => {
        const template = createNotificationEmailTemplate(
            {
                ...PAYLOAD,
                type: 'recovery',
                code: 'operation_recovered',
                occurredAt: '2026-10-18T14:30:00Z',
            },
            options,
        )

        expect(template.subject).toBe('RentnerProxy: Entwarnung: Dynamisches DNS')
        for (const body of [template.html, template.text]) {
            expect(body).toContain('Behoben')
            expect(body).toContain('funktioniert wieder')
            expect(body).toContain('14:30:00 UTC')
            expect(body).not.toContain('DDNS-Aktualisierung fehlgeschlagen')
        }
        expect(template.text).toContain('Beginn der Störung: 18.10.2026, 12:00:00 UTC')
        expect(template.text).toContain('Behoben am: 18.10.2026, 14:30:00 UTC')
    })

    test('does not report a fictitious incident or resource for test messages', () => {
        const template = createNotificationEmailTemplate(
            {
                ...PAYLOAD,
                type: 'test',
                code: 'notification_test',
                severity: 'info',
                resourceId: 'test',
                failures: 0,
            },
            options,
        )

        expect(template.subject).toContain('Testnachricht')
        for (const body of [template.html, template.text]) {
            expect(body).toContain('Testmail')
            expect(body).toContain('Benachrichtigungen anpassen')
            expect(body).not.toContain('Ressourcen-ID')
            expect(body).not.toContain('Beginn der Störung')
            expect(body).not.toContain('Fehlversuche')
            expect(body).not.toContain('fehlgeschlagen')
        }
    })

    test('escapes dynamic HTML and loads only the configured public logo', () => {
        const resourceId = '<img src="file:///private"> & "resource"'
        const id = '</span><script>alert(1)</script>'
        const template = createNotificationEmailTemplate({ ...PAYLOAD, resourceId, id }, options)

        expect(template.html).toContain(Bun.escapeHTML(resourceId))
        expect(template.html).toContain(Bun.escapeHTML(id))
        expect(template.text).toContain(resourceId)
        expect(template.text).toContain(id)
        expect(template.subject).not.toContain(resourceId)
        expect(template.subject).not.toContain(id)
        expect(template.html.match(/<img\b/gi)).toHaveLength(1)
        expect(template.html).toContain('src="https://proxy.example/media/mail-logo/30ee61?v=1"')
        expect(template.html).not.toContain('cid:')
        expect(template.html).not.toContain('<img src="file:///private">')
        expect(template.html).not.toMatch(/<(script|iframe|link)\b/i)
        expect(template.html).not.toMatch(/@import|url\s*\(/i)
    })
})
