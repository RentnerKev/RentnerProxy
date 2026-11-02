import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { OIDC_LIMITS } from '@/config/oidc.config.ts'
import { createOidcFlowStore } from '@/server/Auth/Oidc/oidc-state.server.ts'
import { createOpaqueToken } from '@/server/Auth/Core/tokens.server.ts'
import type { ValkeyCommandClient } from '@/server/Valkey/Types/valkey.types.ts'

class FlowValkey implements ValkeyCommandClient {
    readonly values = new Map<string, string>()
    async ping() {
        return 'PONG'
    }
    async send(command: string, args: string[]): Promise<unknown> {
        const key = args[0]!
        if (command === 'SET') {
            if (this.values.has(key)) return null
            this.values.set(key, args[1]!)
            return 'OK'
        }
        const value = this.values.get(key) ?? null
        if (command === 'GETDEL') this.values.delete(key)
        return value
    }
}

const originalKey = process.env.APP_ENCRYPTION_KEY
beforeEach(() => {
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 19).toString('base64')
})
afterEach(() => {
    if (originalKey === undefined) delete process.env.APP_ENCRYPTION_KEY
    else process.env.APP_ENCRYPTION_KEY = originalKey
})

function fixture() {
    const client = new FlowValkey()
    let now = Date.now()
    const store = createOidcFlowStore({ client: () => client, now: () => now })
    const flow = {
        providerId: '0194f777-4074-7000-8000-000000000001',
        providerRevision: 3,
        issuer: 'https://identity.example.test/realm',
        redirectUri: 'https://proxy.example.test/api/auth/oidc/callback',
        nonce: createOpaqueToken(),
        codeVerifier: createOpaqueToken(),
    }
    return {
        client,
        store,
        flow,
        advance: (ms: number) => {
            now += ms
        },
    }
}

describe('browser-bound one-time OIDC state', () => {
    test('encrypts nonce and verifier with the existing application encryption and hashes bearer identifiers', async () => {
        const { client, store, flow } = fixture()
        const issued = await store.issue(flow)
        const stored = JSON.stringify([...client.values])
        for (const secret of [flow.nonce, flow.codeVerifier, issued.state, issued.browserToken])
            expect(stored).not.toContain(secret)
        expect(await store.consume(issued.state, issued.browserToken)).toEqual(flow)
        expect(client.values.size).toBe(0)
        expect(await store.consume(issued.state, issued.browserToken)).toBeNull()
    })

    test('an unrelated browser cannot consume the legitimate browser exchange', async () => {
        const { store, flow } = fixture()
        const issued = await store.issue(flow)
        expect(await store.consume(issued.state, createOpaqueToken())).toBeNull()
        expect(await store.consume(issued.state, issued.browserToken)).toEqual(flow)
    })

    test('parallel callbacks consume the state exactly once', async () => {
        const { store, flow } = fixture()
        const issued = await store.issue(flow)
        const values = await Promise.all(
            Array.from({ length: 8 }, () => store.consume(issued.state, issued.browserToken)),
        )
        expect(values.filter(Boolean)).toEqual([flow])
    })

    test('enforces the stored lifetime even when the backend has retained the expired value', async () => {
        const { store, flow, advance } = fixture()
        const issued = await store.issue(flow)
        advance(OIDC_LIMITS.flowDurationMs)
        expect(await store.consume(issued.state, issued.browserToken)).toBeNull()
    })

    test('rejects moved ciphertext, malformed envelopes and missing cache service safely', async () => {
        const { client, store, flow } = fixture()
        const first = await store.issue(flow)
        const second = await store.issue(flow)
        const keys = [...client.values.keys()]
        const one = JSON.parse(client.values.get(keys[0]!)!) as Record<string, unknown>
        const two = JSON.parse(client.values.get(keys[1]!)!) as Record<string, unknown>
        client.values.set(
            keys[1]!,
            JSON.stringify({ ...two, ciphertext: one.ciphertext, iv: one.iv }),
        )
        expect(await store.consume(second.state, second.browserToken)).toBeNull()
        client.values.set(keys[0]!, '{broken')
        expect(await store.consume(first.state, first.browserToken)).toBeNull()
        await expect(createOidcFlowStore({ client: () => null }).issue(flow)).rejects.toMatchObject(
            { code: 'configuration_unavailable' },
        )
    })
})
