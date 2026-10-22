import type { SendMailOptions } from 'nodemailer'
import type { MailAppearance } from './mail-theme.types.ts'

export interface NotificationMailClient {
    readonly from: string
    sendMail(options: SendMailOptions): Promise<{
        readonly accepted?: readonly unknown[]
        readonly rejected?: readonly unknown[]
        readonly rejectedErrors?:
            readonly { readonly responseCode?: number | undefined }[] | undefined
    }>
    close(): void
}

export interface NotificationMailOptions {
    readonly appearance?: MailAppearance | undefined
    readonly createClient?: () => NotificationMailClient | null
    readonly timeoutMs?: number
}
