import type { RedisClient } from 'bun'

export interface CachedRedisClient {
    readonly client: RedisClient
    readonly url: string
}

export interface RedisGlobal {
    rentnerproxyRedisClient?: CachedRedisClient
}

export interface RedisCommandClient {
    ping(): Promise<string>
    send(command: string, args: string[]): Promise<unknown>
}

export interface RedisHealthDependencies {
    readonly createProbe: () => Promise<unknown> | null
    readonly timeoutMs: number
    readonly warn: (reason: string) => void
}
