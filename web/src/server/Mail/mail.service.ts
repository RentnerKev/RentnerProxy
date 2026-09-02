import '@tanstack/react-start/server-only'

import { createTransport } from 'nodemailer'

import { getSmtpConfiguration } from '../env.server'
import { getRuntimeManagementOrigin } from '../Configuration/management-origin.server'
import { createSmtpTransportOptions } from './smtp-options'
import {
    createPasswordResetEmailTemplate,
    createUserInviteEmailTemplate,
    type MailTemplate,
} from './templates'

export type SendActionEmailInput = Readonly<{
    to: string
    displayName: string
    token: string
}>

type MailClient = Readonly<{
    from: string
    transport: ReturnType<typeof createTransport>
}>

let mailClient: MailClient | null = null

function getMailClient(): MailClient {
    if (mailClient) {
        return mailClient
    }

    const configuration = getSmtpConfiguration()

    if (!configuration) {
        throw new Error('SMTP is not configured.')
    }

    const transport = createTransport(
        createSmtpTransportOptions({
            ...configuration,
            user: configuration.user ?? null,
            password: configuration.password ?? null,
        }),
    )
    mailClient = {
        from: configuration.from,
        transport,
    }

    return mailClient
}

async function getRequiredAppUrl(): Promise<string> {
    const appUrl = await getRuntimeManagementOrigin()

    if (!appUrl) {
        throw new Error('APP_URL is not configured.')
    }

    return appUrl
}

async function sendMail(to: string, template: MailTemplate): Promise<void> {
    const client = getMailClient()

    await client.transport.sendMail({
        from: client.from,
        to,
        subject: template.subject,
        text: template.text,
        html: template.html,
        disableFileAccess: true,
        disableUrlAccess: true,
    })
}

export async function sendPasswordResetEmailService({
    to,
    displayName,
    token,
}: SendActionEmailInput): Promise<void> {
    const template = createPasswordResetEmailTemplate({
        appUrl: await getRequiredAppUrl(),
        displayName,
        token,
    })

    await sendMail(to, template)
}

export async function sendUserInviteEmailService({
    to,
    displayName,
    token,
}: SendActionEmailInput): Promise<void> {
    const template = createUserInviteEmailTemplate({
        appUrl: await getRequiredAppUrl(),
        displayName,
        token,
    })

    await sendMail(to, template)
}
