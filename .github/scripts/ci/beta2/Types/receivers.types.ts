export interface Beta2ReceiverOptions {
    readonly smtpTls?: { readonly cert: string; readonly key: string }
}

interface SmtpState {
    buffer: string
    tls: boolean
    sender: boolean
    recipient: boolean
    message: boolean
    bytes: number
}

export type Beta2SmtpState = SmtpState

export interface Beta2ReceiverCounters {
    ipv4Reads: number
    ipv6Reads: number
    providerReads: number
    providerWrites: number
    dockerReads: number
    webhooks: number
    smtpMessages: number
    unexpectedRequests: number
    deniedMutations: number
}

export interface Beta2Receivers {
    readonly url: string
    readonly providerUrl: string
    readonly ipv4Url: string
    readonly ipv6Url: string
    readonly smtpPort: number | null
    readonly primaryPort: number
    readonly secondaryPort: number
    readonly dockerAddress: string
    readonly counters: Beta2ReceiverCounters
    readonly setAddress: (v4: string) => void
    readonly recreateContainer: () => void
    readonly setProviderUnavailable: (unavailable: boolean) => void
    readonly setDockerUnavailable: (unavailable: boolean) => void
    readonly setWebhookUnavailable: (unavailable: boolean) => void
    readonly stop: () => Promise<void>
}
