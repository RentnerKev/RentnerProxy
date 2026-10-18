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
    info: { label: 'Information', color: '#a0a5ae', background: '#181b21' },
    warning: { label: 'Warnung', color: '#ffbd66', background: '#181b21' },
    error: { label: 'Fehler', color: '#ffb0b0', background: '#331719' },
    critical: { label: 'Kritisch', color: '#ffb0b0', background: '#331719' },
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
        <th scope="row" align="left" valign="top" style="width:38%;padding:12px 0;border-bottom:1px solid #282c33;color:#a0a5ae;font-size:13px;font-weight:400;line-height:1.5;overflow-wrap:anywhere;">${Bun.escapeHTML(label)}</th>
        <td valign="top" style="padding:12px 0 12px 16px;border-bottom:1px solid #282c33;color:#f4f5f7;font-family:Consolas,'Liberation Mono',monospace;font-size:12px;line-height:1.6;overflow-wrap:anywhere;word-break:break-word;">${Bun.escapeHTML(value)}</td>
    </tr>`
}

export function createNotificationEmailTemplate(payload: NotificationPayload): MailTemplate {
    const category = CATEGORY_COPY[payload.category]
    const isTest = payload.type === 'test'
    const isRecovery = payload.type === 'recovery'
    const status =
        isTest || isRecovery
            ? {
                  label: isTest ? 'Testnachricht' : 'Behoben',
                  color: '#76f895',
                  background: '#102419',
              }
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
    <meta name="color-scheme" content="dark">
    <meta name="supported-color-schemes" content="dark">
    <title>${Bun.escapeHTML(heading)}</title>
</head>
<body style="margin:0;background:#07080a;color:#f4f5f7;font-family:'Segoe UI Variable','Segoe UI',Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;">${Bun.escapeHTML(summary)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;background:#07080a;">
        <tr>
            <td align="center" style="padding:32px 16px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;">
                    <tr>
                        <td style="padding:0 0 20px;">
                            <p style="margin:0;color:#f4f5f7;font-family:'Lilita One','Arial Rounded MT Bold','Trebuchet MS','Segoe UI',sans-serif;font-size:24px;font-weight:800;letter-spacing:-0.04em;">Rentner<span style="color:#30ee61;">Proxy</span></p>
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;background:#0d0f12;border:1px solid #282c33;border-radius:16px;">
                                <tr>
                                    <td style="padding:24px;">
                                        <p style="margin:0 0 12px;color:#65f586;font-family:Consolas,'Liberation Mono',monospace;font-size:10px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;">${Bun.escapeHTML(isTest ? 'E-Mail-Test' : category.label)}</p>
                                        <h1 style="margin:0 0 12px;color:#f4f5f7;font-family:'Lilita One','Arial Rounded MT Bold','Trebuchet MS','Segoe UI',sans-serif;font-size:32px;font-weight:800;letter-spacing:-0.035em;line-height:1.1;overflow-wrap:anywhere;">${Bun.escapeHTML(heading)}</h1>
                                        <p style="margin:0 0 18px;color:#a0a5ae;font-size:14px;line-height:1.6;">${Bun.escapeHTML(summary)}</p>
                                        <span style="display:inline-block;padding:5px 10px;background:${status.background};border:1px solid #282c33;border-radius:999px;color:${status.color};font-size:11px;font-weight:700;line-height:1.5;">${Bun.escapeHTML(status.label)}</span>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding:8px 24px 12px;border-top:1px solid #282c33;">
                                        <table aria-label="Details zur Benachrichtigung" width="100%" cellspacing="0" cellpadding="0" style="width:100%;table-layout:fixed;">
                                            ${details.map(([label, value]) => createDetailRow(label, value)).join('\n')}
                                        </table>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding:8px 24px 24px;">
                                        <p style="margin:0;color:#d7dae0;font-size:13px;line-height:1.7;">${Bun.escapeHTML(nextStep)}</p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:18px 0 0;color:#a0a5ae;font-size:11px;line-height:1.7;">
                            <p style="margin:0;">Automatische Benachrichtigung von RentnerProxy.</p>
                            <p style="margin:6px 0 0;color:#757b85;font-family:Consolas,'Liberation Mono',monospace;font-size:10px;overflow-wrap:anywhere;word-break:break-word;">Nachrichten-ID: ${Bun.escapeHTML(payload.id)}</p>
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
