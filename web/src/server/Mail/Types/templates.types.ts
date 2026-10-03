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

export type ActionMailDefinition = Readonly<{
    path: '/accept-invite' | '/reset-password'
    subject: string
    heading: string
    introduction: string
    actionLabel: string
    securityNotice: string
}>
