import type { RedisClient } from 'bun'

export interface CachedValkeyClient {
    readonly client: RedisClient
    readonly url: string
}

export interface ValkeyGlobal {
    rentnerproxyValkeyClient?: CachedValkeyClient
}

export interface ValkeyCommandClient {
    ping(): Promise<string>
    send(command: string, args: string[]): Promise<unknown>
}

export interface ValkeyHealthDependencies {
    readonly createProbe: () => Promise<unknown> | null
    readonly timeoutMs: number
    readonly warn: (reason: string) => void
}
