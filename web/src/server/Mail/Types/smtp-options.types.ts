export type SmtpConfiguration = Readonly<{
    host: string
    port: number
    secure: boolean
    user: string | null
    password: string | null
    from: string
}>
