import type { createTransport } from 'nodemailer'
import type { MailAppearance } from './mail-theme.types.ts'

export type SendActionEmailInput = Readonly<{
    to: string
    displayName: string
    token: string
    appearance?: MailAppearance | undefined
}>

export type MailClient = Readonly<{
    from: string
    transport: ReturnType<typeof createTransport>
}>
