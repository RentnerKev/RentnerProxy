import '@tanstack/react-start/server-only'

import { RedisClient } from 'bun'

import { getRedisUrl } from '../env.server'
import type { CachedRedisClient, RedisGlobal } from './Types/redis.types'

const CONNECTION_TIMEOUT_MS = 1_200

const redisGlobal = globalThis as typeof globalThis & RedisGlobal
let productionClient: CachedRedisClient | undefined

function getCachedClient(): CachedRedisClient | undefined {
    return process.env.NODE_ENV === 'production'
        ? productionClient
        : redisGlobal.rentnerproxyRedisClient
}

function cacheClient(cachedClient: CachedRedisClient): void {
    if (process.env.NODE_ENV === 'production') {
        productionClient = cachedClient
        return
    }

    redisGlobal.rentnerproxyRedisClient = cachedClient
}

function clearCachedClient(): void {
    productionClient = undefined
    delete redisGlobal.rentnerproxyRedisClient
}

function closeCachedClients(): void {
    const cachedClients = new Set(
        [productionClient, redisGlobal.rentnerproxyRedisClient]
            .filter((cachedClient) => cachedClient !== undefined)
            .map((cachedClient) => cachedClient.client),
    )

    clearCachedClient()

    for (const client of cachedClients) {
        client.close()
    }
}

export function getRedisClient(): RedisClient | null {
    const redisUrl = getRedisUrl()

    if (!redisUrl) {
        closeCachedClients()
        return null
    }

    const cachedClient = getCachedClient()

    if (cachedClient?.url === redisUrl) {
        return cachedClient.client
    }

    if (cachedClient) {
        closeCachedClients()
    }

    const client = new RedisClient(redisUrl, {
        autoReconnect: true,
        connectionTimeout: CONNECTION_TIMEOUT_MS,
        maxRetries: 1,
    })

    cacheClient({ client, url: redisUrl })
    return client
}

export function closeRedisClient(): void {
    closeCachedClients()
}
