export type MailTemplate = Readonly<{
    subject: string
    text: string
    html: string
}>

export type ActionMailTemplateInput = Readonly<{
    appUrl: string
    displayName: string
    token: string
}>

type ActionMailDefinition = Readonly<{
    path: '/accept-invite' | '/reset-password'
    subject: string
    heading: string
    introduction: string
    actionLabel: string
    securityNotice: string
}>

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

export function escapeMailHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;')
}

function createActionUrl(appUrl: string, path: ActionMailDefinition['path'], token: string) {
    if (token.length === 0) {
        throw new Error('A mail action token is required.')
    }

    let configuredAppUrl: URL

    try {
        configuredAppUrl = new URL(appUrl)
    } catch {
        throw new Error('APP_URL is invalid.')
    }

    if (
        (configuredAppUrl.protocol !== 'http:' && configuredAppUrl.protocol !== 'https:') ||
        configuredAppUrl.username ||
        configuredAppUrl.password ||
        !configuredAppUrl.hostname
    ) {
        throw new Error('APP_URL is invalid.')
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
    const safeGreeting = escapeMailHtml(greeting)
    const safeHeading = escapeMailHtml(definition.heading)
    const safeIntroduction = escapeMailHtml(definition.introduction)
    const safeActionLabel = escapeMailHtml(definition.actionLabel)
    const safeActionUrl = escapeMailHtml(actionUrl)
    const safeSecurityNotice = escapeMailHtml(definition.securityNotice)

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

    const html = `<!doctype html>
<html lang="de">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${safeHeading}</title>
</head>
<body style="margin:0;background:#081923;color:#e7f0f2;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;background:#081923;padding:32px 16px;">
        <tr>
            <td align="center">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#102a38;border:1px solid #1f4554;border-radius:10px;">
                    <tr>
                        <td style="padding:28px 32px 12px;">
                            <div style="color:#6ee7a5;font-size:14px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">RentnerProxy</div>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:8px 32px 32px;">
                            <h1 style="margin:0 0 20px;color:#ffffff;font-size:25px;line-height:1.25;">${safeHeading}</h1>
                            <p style="margin:0 0 12px;color:#e7f0f2;font-size:16px;line-height:1.6;">${safeGreeting}</p>
                            <p style="margin:0 0 24px;color:#c8d9de;font-size:16px;line-height:1.6;">${safeIntroduction}</p>
                            <p style="margin:0 0 24px;">
                                <a href="${safeActionUrl}" style="display:inline-block;background:#2f855a;border-radius:7px;color:#ffffff;font-size:16px;font-weight:700;padding:13px 20px;text-decoration:none;">${safeActionLabel}</a>
                            </p>
                            <p style="margin:0 0 8px;color:#9fb7bf;font-size:13px;line-height:1.5;">Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:</p>
                            <p style="margin:0 0 24px;color:#8ee0b1;font-size:13px;line-height:1.5;overflow-wrap:anywhere;">${safeActionUrl}</p>
                            <div style="border-top:1px solid #1f4554;padding-top:20px;">
                                <p style="margin:0;color:#9fb7bf;font-size:13px;line-height:1.5;">${safeSecurityNotice}</p>
                            </div>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`

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
