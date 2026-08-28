import { afterEach, describe, expect, test } from 'bun:test'

import { closeRedisClient, getRedisClient } from '../server/redis/client.server'

const originalRedisUrl = process.env.REDIS_URL

afterEach(() => {
    closeRedisClient()

    if (originalRedisUrl === undefined) {
        delete process.env.REDIS_URL
    } else {
        process.env.REDIS_URL = originalRedisUrl
    }
})

describe('getRedisClient', () => {
    test('does not construct a client for missing or invalid configuration', () => {
        delete process.env.REDIS_URL
        expect(getRedisClient()).toBeNull()

        process.env.REDIS_URL = 'https://redis.example'
        expect(getRedisClient()).toBeNull()
    })

    test('caches a native Bun Redis client and can close it repeatedly', () => {
        process.env.REDIS_URL = 'redis://127.0.0.1:6379/0'

        const firstClient = getRedisClient()
        const secondClient = getRedisClient()

        expect(firstClient).not.toBeNull()
        expect(secondClient).toBe(firstClient)

        delete process.env.REDIS_URL
        expect(getRedisClient()).toBeNull()

        process.env.REDIS_URL = 'redis://127.0.0.1:6379/0'
        expect(getRedisClient()).not.toBe(firstClient)
        closeRedisClient()
        closeRedisClient()
    })
})
