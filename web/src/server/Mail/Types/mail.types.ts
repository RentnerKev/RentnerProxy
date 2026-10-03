import type { createTransport } from 'nodemailer'

export type SendActionEmailInput = Readonly<{
    to: string
    displayName: string
    token: string
}>

export type MailClient = Readonly<{
    from: string
    transport: ReturnType<typeof createTransport>
}>
