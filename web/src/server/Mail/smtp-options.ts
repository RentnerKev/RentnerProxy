export type SmtpConfiguration = Readonly<{
    host: string
    port: number
    secure: boolean
    user: string | null
    password: string | null
    from: string
}>

export function createSmtpTransportOptions(configuration: SmtpConfiguration) {
    const hasUser = configuration.user !== null
    const hasPassword = configuration.password !== null

    if (hasUser !== hasPassword) {
        throw new Error('SMTP credentials must be configured together.')
    }

    const sharedOptions = {
        host: configuration.host,
        port: configuration.port,
        secure: configuration.secure,
        requireTLS: !configuration.secure,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 30_000,
        disableFileAccess: true,
        disableUrlAccess: true,
        tls: {
            minVersion: 'TLSv1.2' as const,
        },
    }

    if (!hasUser || !hasPassword) {
        return sharedOptions
    }

    return {
        ...sharedOptions,
        auth: {
            user: configuration.user,
            pass: configuration.password,
        },
    }
}
