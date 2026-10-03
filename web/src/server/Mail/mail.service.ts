import type { SendActionEmailInput, MailClient } from './Types/mail.types.ts'
import '@tanstack/react-start/server-only'

import { createTransport } from 'nodemailer'

import { getSmtpConfiguration } from '@/server/env.server.ts'
import { getRuntimeManagementOrigin } from '@/server/Configuration/management-origin.server.ts'
import { createSmtpTransportOptions } from './smtp-options.ts'
import { createPasswordResetEmailTemplate, createUserInviteEmailTemplate } from './templates.ts'
import type { MailTemplate } from './Types/templates.types.ts'

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

async function getRequiredPublicOrigin(): Promise<string> {
    const publicOrigin = await getRuntimeManagementOrigin()

    if (!publicOrigin) {
        throw new Error('RENTNERPROXY_PUBLIC_ORIGIN is not configured.')
    }

    return publicOrigin
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
        appUrl: await getRequiredPublicOrigin(),
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
        appUrl: await getRequiredPublicOrigin(),
        displayName,
        token,
    })

    await sendMail(to, template)
}
