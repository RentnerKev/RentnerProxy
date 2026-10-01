import '@tanstack/react-start/server-only'

import { RedisClient } from 'bun'

import { getValkeyUrl } from '../env.server'
import type { CachedValkeyClient, ValkeyGlobal } from './Types/valkey.types'

const CONNECTION_TIMEOUT_MS = 1_200

const valkeyGlobal = globalThis as typeof globalThis & ValkeyGlobal
let productionClient: CachedValkeyClient | undefined

function getCachedClient(): CachedValkeyClient | undefined {
    return process.env.NODE_ENV === 'production'
        ? productionClient
        : valkeyGlobal.rentnerproxyValkeyClient
}

function cacheClient(cachedClient: CachedValkeyClient): void {
    if (process.env.NODE_ENV === 'production') {
        productionClient = cachedClient
        return
    }

    valkeyGlobal.rentnerproxyValkeyClient = cachedClient
}

function clearCachedClient(): void {
    productionClient = undefined
    delete valkeyGlobal.rentnerproxyValkeyClient
}

function closeCachedClients(): void {
    const cachedClients = new Set(
        [productionClient, valkeyGlobal.rentnerproxyValkeyClient]
            .filter((cachedClient) => cachedClient !== undefined)
            .map((cachedClient) => cachedClient.client),
    )

    clearCachedClient()

    for (const client of cachedClients) {
        client.close()
    }
}

export function getValkeyClient(): RedisClient | null {
    const valkeyUrl = getValkeyUrl()

    if (!valkeyUrl) {
        closeCachedClients()
        return null
    }

    const cachedClient = getCachedClient()

    if (cachedClient?.url === valkeyUrl) {
        return cachedClient.client
    }

    if (cachedClient) {
        closeCachedClients()
    }

    const client = new RedisClient(valkeyUrl, {
        autoReconnect: true,
        connectionTimeout: CONNECTION_TIMEOUT_MS,
    })
    // oxlint-disable-next-line unicorn/prefer-add-event-listener -- Bun RedisClient exposes onclose, not EventTarget.
    client.onclose = () => {
        if (getCachedClient()?.client === client) clearCachedClient()
    }

    cacheClient({ client, url: valkeyUrl })
    return client
}

export function closeValkeyClient(): void {
    closeCachedClients()
}
