export interface SmtpConfiguration {
    readonly from: string
    readonly host: string
    readonly password?: string
    readonly port: number
    readonly secure: boolean
    readonly user?: string
}

export interface WebAuthnConfiguration {
    readonly origin: string
    readonly rpId: string
    readonly rpName: string
}
