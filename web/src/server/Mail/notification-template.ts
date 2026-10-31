import type {
    NotificationCategory,
    NotificationPayload,
} from '@/lib/Notifications/Types/notifications.types.ts'
import type {
    MailTemplate,
    NotificationMailCategoryDefinition,
    NotificationMailTemplateOptions,
} from './Types/templates.types.ts'
import type { MailTheme } from './Types/mail-theme.types.ts'
import { createMailTheme } from './mail-theme.ts'
import { createMailHtml } from './layout.ts'

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
    backup: {
        label: 'Backups',
        heading: 'Backup fehlgeschlagen',
        summary: 'Ein verwaltetes Backup wurde nicht erfolgreich abgeschlossen.',
        recovery: 'Ein verwaltetes Backup wurde erfolgreich abgeschlossen.',
        nextStep: 'Prüfe den Backup-Status in RentnerProxy.',
    },
    proxy_configuration: {
        label: 'Proxy-Konfiguration',
        heading: 'Proxy-Konfiguration nicht übernommen',
        summary: 'Die gewünschte Proxy-Konfiguration konnte nicht aktiviert werden.',
        recovery: 'Die gewünschte Proxy-Konfiguration wurde erfolgreich aktiviert.',
        nextStep: 'Prüfe den Proxy-Status und die letzte Fehlermeldung in RentnerProxy.',
    },
} satisfies Record<NotificationCategory, NotificationMailCategoryDefinition>

const DATE_FORMAT = new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'UTC',
})

function formatTime(value: string): string {
    return `${DATE_FORMAT.format(new Date(value))} UTC`
}

function createDetailRow(label: string, value: string, theme: MailTheme): string {
    return `<tr>
        <th scope="row" align="left" valign="top" style="width:38%;padding:12px 0;border-bottom:1px solid ${theme.border};color:${theme.muted};font-size:13px;font-weight:400;line-height:1.5;overflow-wrap:anywhere;">${Bun.escapeHTML(label)}</th>
        <td valign="top" style="padding:12px 0 12px 16px;border-bottom:1px solid ${theme.border};color:${theme.ink};font-family:Consolas,'Liberation Mono',monospace;font-size:12px;line-height:1.6;overflow-wrap:anywhere;word-break:break-word;">${Bun.escapeHTML(value)}</td>
    </tr>`
}

export function createNotificationEmailTemplate(
    payload: NotificationPayload,
    options: NotificationMailTemplateOptions,
): MailTemplate {
    const { appUrl, appearance } = options
    const theme = createMailTheme(appearance)
    const severityStyle = {
        info: { label: 'Information', color: theme.muted, background: theme.neutral },
        warning: { label: 'Warnung', color: theme.warningText, background: theme.neutral },
        error: { label: 'Fehler', color: theme.dangerText, background: theme.dangerBackground },
        critical: {
            label: 'Kritisch',
            color: theme.dangerText,
            background: theme.dangerBackground,
        },
    }
    const category = CATEGORY_COPY[payload.category]
    const isBackup = payload.category === 'backup'
    const isSuccess = payload.type === 'success'
    const isTest = payload.type === 'test'
    const isRecovery = payload.type === 'recovery'
    const isManualDns =
        payload.code === 'certificate_renewal_manual_dns_required' && !isTest && !isRecovery
    const status =
        isTest || isRecovery || isSuccess
            ? {
                  label: isTest ? 'Testnachricht' : isSuccess ? 'Abgeschlossen' : 'Behoben',
                  color: theme.successText,
                  background: theme.successBackground,
              }
            : isManualDns
              ? {
                    label: 'Aktion erforderlich',
                    color: theme.warningText,
                    background: theme.neutral,
                }
              : severityStyle[payload.severity]
    const heading = isTest
        ? 'Testnachricht angekommen'
        : isSuccess
          ? 'Backup erfolgreich abgeschlossen'
          : isRecovery
            ? `Entwarnung: ${category.label}`
            : isManualDns
              ? 'Neue DNS-TXT-Werte für die Erneuerung nötig'
              : category.heading
    const summary = isTest
        ? 'Diese Testmail bestätigt, dass RentnerProxy Nachrichten an diese Adresse zustellen kann.'
        : isRecovery || isSuccess
          ? category.recovery
          : isManualDns
            ? 'Die Zertifikatserneuerung wartet auf deine manuelle DNS-Bestätigung. Dafür werden neue TXT-Werte benötigt.'
            : category.summary
    const nextStep = isTest
        ? 'Ereignisse und Empfänger kannst du in deinem Konto unter Benachrichtigungen anpassen.'
        : isRecovery || isSuccess
          ? 'Für diese Meldung ist keine weitere Aktion erforderlich.'
          : isManualDns
            ? 'Öffne das betroffene Zertifikat in RentnerProxy. Lege alle dort gezeigten TXT-Werte unter den exakten Namen an und wähle „DNS prüfen und fortsetzen“. Bestehende andere TXT-Werte erhalten.'
            : category.nextStep
    const details: [string, string][] = isTest
        ? [['Versendet am', formatTime(payload.occurredAt)]]
        : isBackup
          ? [
                ['Bereich', category.label],
                ['Backup-ID', payload.resourceId],
                ['Abgeschlossen am', formatTime(payload.occurredAt)],
                ['Ergebnis', isSuccess ? 'Erfolgreich' : 'Fehlgeschlagen'],
            ]
          : [
                ['Bereich', category.label],
                ['Ressourcen-ID', payload.resourceId],
                [
                    isManualDns ? 'Erneuerung gestartet' : 'Beginn der Störung',
                    formatTime(payload.startedAt),
                ],
                [isRecovery ? 'Behoben am' : 'Letzte Meldung', formatTime(payload.occurredAt)],
                ...(isManualDns
                    ? []
                    : [['Fehlversuche', String(payload.failures)] as [string, string]]),
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
    const html = createMailHtml({
        appUrl,
        heading,
        eyebrow: isTest ? 'E-Mail-Test' : category.label,
        preview: summary,
        appearance,
        footerText: `Nachrichten-ID: ${payload.id}`,
        contentRowsHtml: `<tr>
            <td style="padding:0 24px 24px;">
                <p style="margin:0 0 18px;color:${theme.muted};font-size:14px;line-height:1.6;">${Bun.escapeHTML(summary)}</p>
                <span style="display:inline-block;padding:5px 10px;background:${status.background};border:1px solid ${theme.border};border-radius:999px;color:${status.color};font-size:11px;font-weight:700;line-height:1.5;">${Bun.escapeHTML(status.label)}</span>
            </td>
        </tr>
        <tr>
            <td style="padding:8px 24px 12px;border-top:1px solid ${theme.border};">
                <table aria-label="Details zur Benachrichtigung" width="100%" cellspacing="0" cellpadding="0" style="width:100%;table-layout:fixed;">
                    ${details.map(([label, value]) => createDetailRow(label, value, theme)).join('\n')}
                </table>
            </td>
        </tr>
        <tr>
            <td style="padding:8px 24px 24px;">
                <p style="margin:0;color:${theme.softInk};font-size:13px;line-height:1.7;">${Bun.escapeHTML(nextStep)}</p>
            </td>
        </tr>`,
    })

    return { subject, text, html }
}
