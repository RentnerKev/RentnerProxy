import { afterEach, describe, expect, test } from 'bun:test'

import { closeValkeyClient, getValkeyClient } from '@/server/valkey/client.server.ts'

const originalValkeyUrl = process.env.VALKEY_URL

afterEach(() => {
    closeValkeyClient()

    if (originalValkeyUrl === undefined) {
        delete process.env.VALKEY_URL
    } else {
        process.env.VALKEY_URL = originalValkeyUrl
    }
})

describe('getValkeyClient', () => {
    test('does not construct a client for missing or invalid configuration', () => {
        delete process.env.VALKEY_URL
        expect(getValkeyClient()).toBeNull()

        process.env.VALKEY_URL = 'https://valkey.example'
        expect(getValkeyClient()).toBeNull()
    })

    test('caches a native Bun RedisClient for Valkey and can close it repeatedly', () => {
        process.env.VALKEY_URL = 'redis://127.0.0.1:6379/0'

        const firstClient = getValkeyClient()
        const secondClient = getValkeyClient()

        expect(firstClient).not.toBeNull()
        expect(secondClient).toBe(firstClient)

        delete process.env.VALKEY_URL
        expect(getValkeyClient()).toBeNull()

        process.env.VALKEY_URL = 'redis://127.0.0.1:6379/0'
        expect(getValkeyClient()).not.toBe(firstClient)
        closeValkeyClient()
        closeValkeyClient()
    })
})
