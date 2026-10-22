export interface RegistryPreflightInput {
    readonly image: string
    readonly tags: readonly string[]
    readonly expectedDigest: string
    readonly username: string
    readonly password: string
}

export type RegistryFetch = (url: string, init: RequestInit) => Promise<Response>

export interface RegistryPreflightLimits {
    readonly timeoutMs: number
    readonly manifestBytes: number
}
