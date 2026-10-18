import type { SendMailOptions } from 'nodemailer'

export interface NotificationMailClient {
    readonly from: string
    sendMail(options: SendMailOptions): Promise<{
        readonly accepted?: readonly unknown[]
        readonly rejected?: readonly unknown[]
        readonly rejectedErrors?:
            | readonly { readonly responseCode?: number | undefined }[]
            | undefined
    }>
    close(): void
}

export interface NotificationMailOptions {
    readonly createClient?: () => NotificationMailClient | null
    readonly timeoutMs?: number
}
