import { createMailLogoAttachment } from './mail-logo.ts'
import { createMailTheme } from './mail-theme.ts'
import type { MailAppearance } from './Types/mail-theme.types.ts'
import type { MailTemplate } from './Types/templates.types.ts'

export async function createMailMessage(template: MailTemplate, appearance?: MailAppearance) {
    const theme = createMailTheme(appearance)
    return {
        ...template,
        attachments: [await createMailLogoAttachment(theme.accent)],
        disableFileAccess: true,
        disableUrlAccess: true,
    }
}
