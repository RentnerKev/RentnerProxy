import type {
    NotificationCategory,
    NotificationPayload,
} from '@/lib/Notifications/Types/notifications.types.ts'
import type { MailTemplate, NotificationMailCategoryDefinition } from './Types/templates.types.ts'

const CATEGORY_COPY = {
    certificate_renewal: {
        label: 'Zertifikate',
        heading: 'Zertifikat nicht erneuert',
        summary: 'Ein Zertifikat konnte nicht erneuert werden.',
        recovery: 'Das betroffene Zertifikat wurde wieder erfolgreich bereitgestellt.',
        nextStep:
            'Öffne die Zertifikate in RentnerProxy und prüfe den betroffenen Eintrag sowie seine letzte Fehlermeldung.',
    },
    ddns: {
        label: 'Dynamisches DNS',
        heading: 'DDNS-Aktualisierung fehlgeschlagen',
        summary: 'Ein verwalteter DNS-Eintrag konnte nicht aktualisiert werden.',
        recovery: 'Die Aktualisierung des betroffenen DNS-Eintrags funktioniert wieder.',
        nextStep:
            'Öffne die DDNS-Einstellungen in RentnerProxy und prüfe den betroffenen Eintrag und seine DNS-Verbindung.',
    },
    proxy_configuration: {
        label: 'Proxy-Konfiguration',
        heading: 'Proxy-Konfiguration nicht übernommen',
        summary: 'Die gewünschte Proxy-Konfiguration konnte nicht aktiviert werden.',
        recovery: 'Die gewünschte Proxy-Konfiguration wurde erfolgreich aktiviert.',
        nextStep: 'Prüfe den Proxy-Status und die letzte Fehlermeldung in RentnerProxy.',
    },
} satisfies Record<NotificationCategory, NotificationMailCategoryDefinition>

const SEVERITY_STYLE = {
    info: { label: 'Information', color: '#93c5fd', background: '#16324a' },
    warning: { label: 'Warnung', color: '#fcd34d', background: '#3a3020' },
    error: { label: 'Fehler', color: '#fca5a5', background: '#3e252c' },
    critical: { label: 'Kritisch', color: '#fda4af', background: '#4b2030' },
} as const

const DATE_FORMAT = new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'UTC',
})

function formatTime(value: string): string {
    return `${DATE_FORMAT.format(new Date(value))} UTC`
}

function createDetailRow(label: string, value: string): string {
    return `<tr>
        <th scope="row" align="left" valign="top" style="width:38%;padding:12px 0;border-bottom:1px solid #1f4554;color:#9fb7bf;font-size:13px;font-weight:400;line-height:1.5;overflow-wrap:anywhere;">${Bun.escapeHTML(label)}</th>
        <td valign="top" style="padding:12px 0 12px 16px;border-bottom:1px solid #1f4554;color:#e7f0f2;font-size:13px;line-height:1.5;overflow-wrap:anywhere;word-break:break-word;">${Bun.escapeHTML(value)}</td>
    </tr>`
}

export function createNotificationEmailTemplate(payload: NotificationPayload): MailTemplate {
    const category = CATEGORY_COPY[payload.category]
    const isTest = payload.type === 'test'
    const isRecovery = payload.type === 'recovery'
    const status = isTest
        ? { label: 'Testnachricht', color: '#93c5fd', background: '#16324a' }
        : isRecovery
          ? { label: 'Behoben', color: '#6ee7a5', background: '#173c32' }
          : SEVERITY_STYLE[payload.severity]
    const heading = isTest
        ? 'Testnachricht angekommen'
        : isRecovery
          ? `Entwarnung: ${category.label}`
          : category.heading
    const summary = isTest
        ? 'Diese Testmail bestätigt, dass RentnerProxy Nachrichten an diese Adresse zustellen kann.'
        : isRecovery
          ? category.recovery
          : category.summary
    const nextStep = isTest
        ? 'Ereignisse und Empfänger kannst du in deinem Konto unter Benachrichtigungen anpassen.'
        : isRecovery
          ? 'Für diese Meldung ist keine weitere Aktion erforderlich.'
          : category.nextStep
    const details: [string, string][] = isTest
        ? [['Versendet am', formatTime(payload.occurredAt)]]
        : [
              ['Bereich', category.label],
              ['Ressourcen-ID', payload.resourceId],
              ['Beginn der Störung', formatTime(payload.startedAt)],
              [isRecovery ? 'Behoben am' : 'Letzte Meldung', formatTime(payload.occurredAt)],
              ['Fehlversuche', String(payload.failures)],
          ]
    const subject = `RentnerProxy: ${heading}`
    const text = [
        'RentnerProxy',
        '',
        `${status.label} · ${heading}`,
        '',
        summary,
        '',
        ...details.map(([label, value]) => `${label}: ${value}`),
        '',
        nextStep,
        '',
        `Nachrichten-ID: ${payload.id}`,
    ].join('\n')
    const html = `<!doctype html>
<html lang="de">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${Bun.escapeHTML(heading)}</title>
</head>
<body style="margin:0;background:#081923;color:#e7f0f2;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;">${Bun.escapeHTML(summary)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;background:#081923;">
        <tr>
            <td align="center" style="padding:32px 16px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#102a38;border:1px solid #1f4554;border-top:4px solid ${status.color};border-radius:12px;">
                    <tr>
                        <td style="padding:28px 24px 24px;">
                            <p style="margin:0 0 28px;color:#6ee7a5;font-size:14px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">RentnerProxy</p>
                            <span style="display:inline-block;padding:6px 10px;background:${status.background};border-radius:6px;color:${status.color};font-size:12px;font-weight:700;">${Bun.escapeHTML(status.label)}</span>
                            <h1 style="margin:18px 0 12px;color:#ffffff;font-size:26px;line-height:1.25;overflow-wrap:anywhere;">${Bun.escapeHTML(heading)}</h1>
                            <p style="margin:0 0 24px;color:#c8d9de;font-size:16px;line-height:1.6;">${Bun.escapeHTML(summary)}</p>
                            <table aria-label="Details zur Benachrichtigung" width="100%" cellspacing="0" cellpadding="0" style="width:100%;table-layout:fixed;border-top:1px solid #1f4554;">
                                ${details.map(([label, value]) => createDetailRow(label, value)).join('\n')}
                            </table>
                            <p style="margin:24px 0 0;padding:16px;background:#0b202c;border-radius:8px;color:#c8d9de;font-size:14px;line-height:1.6;">${Bun.escapeHTML(nextStep)}</p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:20px 24px;border-top:1px solid #1f4554;color:#9fb7bf;font-size:12px;line-height:1.6;">
                            Automatische Benachrichtigung von RentnerProxy.<br>
                            <span style="overflow-wrap:anywhere;word-break:break-word;">Nachrichten-ID: ${Bun.escapeHTML(payload.id)}</span>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`

    return { subject, text, html }
}
