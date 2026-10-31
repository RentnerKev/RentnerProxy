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
    proxy_configuration: {
        label: 'Proxy-Konfiguration',
        heading: 'Proxy-Konfiguration nicht übernommen',
        summary: 'Die gewünschte Proxy-Konfiguration konnte nicht aktiviert werden.',
        recovery: 'Die gewünschte Proxy-Konfiguration wurde erfolgreich aktiviert.',
        nextStep: 'Prüfe den Proxy-Status und die letzte Fehlermeldung in RentnerProxy.',
    },
    host_availability: {
        label: 'Host-Verfügbarkeit',
        heading: 'Überwachter Upstream nicht erreichbar',
        summary:
            'Die Verfügbarkeitsprüfung auf der Appliance hat eine Störung des überwachten Upstreams bestätigt.',
        recovery:
            'Die Verfügbarkeitsprüfung auf der Appliance ist wieder erfolgreich. Die öffentliche Erreichbarkeit wird damit nicht geprüft.',
        nextStep:
            'Öffne den betroffenen Proxy-Host in RentnerProxy und prüfe seine Verfügbarkeitshistorie.',
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
    const isTest = payload.type === 'test'
    const isRecovery = payload.type === 'recovery'
    const isManualDns =
        payload.code === 'certificate_renewal_manual_dns_required' && !isTest && !isRecovery
    const status =
        isTest || isRecovery
            ? {
                  label: isTest ? 'Testnachricht' : 'Behoben',
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
        : isRecovery
          ? `Entwarnung: ${category.label}`
          : isManualDns
            ? 'Neue DNS-TXT-Werte für die Erneuerung nötig'
            : category.heading
    const summary = isTest
        ? 'Diese Testmail bestätigt, dass RentnerProxy Nachrichten an diese Adresse zustellen kann.'
        : isRecovery
          ? category.recovery
          : isManualDns
            ? 'Die Zertifikatserneuerung wartet auf deine manuelle DNS-Bestätigung. Dafür werden neue TXT-Werte benötigt.'
            : category.summary
    const nextStep = isTest
        ? 'Ereignisse und Empfänger kannst du in deinem Konto unter Benachrichtigungen anpassen.'
        : isRecovery
          ? 'Für diese Meldung ist keine weitere Aktion erforderlich.'
          : isManualDns
            ? 'Öffne das betroffene Zertifikat in RentnerProxy. Lege alle dort gezeigten TXT-Werte unter den exakten Namen an und wähle „DNS prüfen und fortsetzen“. Bestehende andere TXT-Werte erhalten.'
            : category.nextStep
    const details: [string, string][] = isTest
        ? [['Versendet am', formatTime(payload.occurredAt)]]
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
    const managementUrl = !isTest && payload.host ? new URL('/proxy-hosts', appUrl).href : null
    if (!isTest && payload.host) {
        const summaries = {
            unexpected_status: 'Der Upstream hat einen unerwarteten HTTP-Status zurückgegeben.',
            upstream_unreachable: 'Die Verbindung zum Upstream ist fehlgeschlagen.',
            upstream_timeout: 'Der Upstream hat nicht rechtzeitig geantwortet.',
            upstream_dns_failed: 'Der DNS-Name des Upstreams konnte nicht aufgelöst werden.',
            tls_failed: 'Die TLS-Prüfung des Upstreams ist fehlgeschlagen.',
        }
        details.unshift(['Host', payload.host.domain])
        details.push(
            ['Störung bestätigt', formatTime(payload.host.detectedAt)],
            [
                'Fehler',
                Object.hasOwn(summaries, payload.host.failureCode)
                    ? summaries[payload.host.failureCode as keyof typeof summaries]
                    : 'Die Verfügbarkeitsprüfung ist fehlgeschlagen.',
            ],
        )
        if (isRecovery && payload.host.recoveryStartedAt)
            details.push(['Erste erfolgreiche Prüfung', formatTime(payload.host.recoveryStartedAt)])
    }
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
        ...(managementUrl ? ['', `Host-Verwaltung: ${managementUrl}`] : []),
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
                ${managementUrl ? `<p style="margin:12px 0 0;"><a href="${Bun.escapeHTML(managementUrl)}" style="color:${theme.ink};">Host-Verwaltung öffnen</a></p>` : ''}
            </td>
        </tr>`,
    })

    return { subject, text, html }
}
