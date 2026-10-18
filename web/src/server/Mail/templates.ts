import type {
    MailTemplate,
    ActionMailTemplateInput,
    ActionMailDefinition,
} from './Types/templates.types.ts'
import { createMailHtml } from './layout.ts'
import { createMailTheme } from './mail-theme.ts'

const PASSWORD_RESET_DEFINITION: ActionMailDefinition = {
    path: '/reset-password',
    subject: 'RentnerProxy-Passwort zurücksetzen',
    heading: 'Passwort zurücksetzen',
    introduction: 'Für dein RentnerProxy-Konto wurde das Zurücksetzen des Passworts angefordert.',
    actionLabel: 'Neues Passwort festlegen',
    securityNotice:
        'Wenn du das nicht angefordert hast, kannst du diese E-Mail ignorieren. Dein Passwort bleibt unverändert.',
}

const USER_INVITE_DEFINITION: ActionMailDefinition = {
    path: '/accept-invite',
    subject: 'Deine Einladung zu RentnerProxy',
    heading: 'Einladung zu RentnerProxy',
    introduction:
        'Für dich wurde ein RentnerProxy-Konto vorbereitet. Über den folgenden Link kannst du deine Einladung annehmen und dein Passwort festlegen.',
    actionLabel: 'Einladung annehmen',
    securityNotice: 'Wenn du diese Einladung nicht erwartest, kannst du diese E-Mail ignorieren.',
}

function createActionUrl(appUrl: string, path: ActionMailDefinition['path'], token: string) {
    if (token.length === 0) {
        throw new Error('A mail action token is required.')
    }

    let configuredAppUrl: URL

    try {
        configuredAppUrl = new URL(appUrl)
    } catch {
        throw new Error('RENTNERPROXY_PUBLIC_ORIGIN is invalid.')
    }

    if (
        (configuredAppUrl.protocol !== 'http:' && configuredAppUrl.protocol !== 'https:') ||
        configuredAppUrl.username ||
        configuredAppUrl.password ||
        !configuredAppUrl.hostname
    ) {
        throw new Error('RENTNERPROXY_PUBLIC_ORIGIN is invalid.')
    }

    const actionUrl = new URL(path, configuredAppUrl)
    actionUrl.search = ''
    actionUrl.hash = `token=${encodeURIComponent(token)}`

    return actionUrl.toString()
}

function createGreeting(displayName: string): string {
    const normalizedDisplayName = displayName.trim()

    return normalizedDisplayName ? `Hallo ${normalizedDisplayName},` : 'Hallo,'
}

function createActionMailTemplate(
    definition: ActionMailDefinition,
    input: ActionMailTemplateInput,
): MailTemplate {
    const actionUrl = createActionUrl(input.appUrl, definition.path, input.token)
    const greeting = createGreeting(input.displayName)
    const safeGreeting = Bun.escapeHTML(greeting)
    const safeIntroduction = Bun.escapeHTML(definition.introduction)
    const safeActionLabel = Bun.escapeHTML(definition.actionLabel)
    const safeActionUrl = Bun.escapeHTML(actionUrl)
    const safeSecurityNotice = Bun.escapeHTML(definition.securityNotice)
    const theme = createMailTheme(input.appearance)

    const text = [
        'RentnerProxy',
        '',
        definition.heading,
        '',
        greeting,
        definition.introduction,
        '',
        `${definition.actionLabel}:`,
        actionUrl,
        '',
        definition.securityNotice,
    ].join('\n')

    const html = createMailHtml({
        heading: definition.heading,
        eyebrow: 'Dein Konto',
        preview: definition.introduction,
        appearance: input.appearance,
        contentRowsHtml: `<tr>
            <td style="padding:0 24px 24px;">
                <p style="margin:0 0 12px;color:${theme.ink};font-size:14px;line-height:1.7;">${safeGreeting}</p>
                <p style="margin:0 0 24px;color:${theme.muted};font-size:14px;line-height:1.7;">${safeIntroduction}</p>
                <p style="margin:0 0 24px;">
                    <a href="${safeActionUrl}" style="display:inline-block;background:${theme.accent};border:1px solid ${theme.accent};border-radius:12px;color:${theme.accentForeground};font-size:14px;font-weight:700;padding:13px 20px;text-decoration:none;">${safeActionLabel}</a>
                </p>
                <p style="margin:0 0 8px;color:${theme.muted};font-size:12px;line-height:1.6;">Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:</p>
                <p style="margin:0 0 24px;color:${theme.accentText};font-family:Consolas,'Liberation Mono',monospace;font-size:12px;line-height:1.6;overflow-wrap:anywhere;word-break:break-word;">${safeActionUrl}</p>
                <p style="margin:0;border-top:1px solid ${theme.border};padding-top:20px;color:${theme.muted};font-size:12px;line-height:1.7;">${safeSecurityNotice}</p>
            </td>
        </tr>`,
    })

    return {
        subject: definition.subject,
        text,
        html,
    }
}

export function createPasswordResetEmailTemplate(input: ActionMailTemplateInput): MailTemplate {
    return createActionMailTemplate(PASSWORD_RESET_DEFINITION, input)
}

export function createUserInviteEmailTemplate(input: ActionMailTemplateInput): MailTemplate {
    return createActionMailTemplate(USER_INVITE_DEFINITION, input)
}
