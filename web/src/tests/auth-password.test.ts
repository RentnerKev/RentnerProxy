import { describe, expect, test } from 'bun:test'

import { hashPassword, isValidPassword, verifyPassword } from '../server/Auth/Core/password.server'
import { createOpaqueToken, hashOpaqueToken } from '../server/Auth/Core/tokens.server'

const PASSWORD = 'correct horse battery staple'

describe('password hashing', () => {
    test('accepts any non-empty password within the technical size limit', () => {
        expect(isValidPassword('x')).toBeTrue()
        expect(isValidPassword(' ')).toBeTrue()
        expect(isValidPassword('')).toBeFalse()
        expect(isValidPassword('x'.repeat(256))).toBeTrue()
        expect(isValidPassword('x'.repeat(257))).toBeFalse()
    })

    test('uses Argon2id with a unique salt and never returns plaintext', async () => {
        const [firstHash, secondHash] = await Promise.all([
            hashPassword(PASSWORD),
            hashPassword(PASSWORD),
        ])

        expect(firstHash.startsWith('$argon2id$')).toBeTrue()
        expect(secondHash.startsWith('$argon2id$')).toBeTrue()
        expect(firstHash).not.toBe(secondHash)
        expect(firstHash).not.toContain(PASSWORD)
        expect(secondHash).not.toContain(PASSWORD)
    })

    test('accepts the original password and rejects a different password', async () => {
        const passwordHash = await hashPassword(PASSWORD)

        expect(await verifyPassword(PASSWORD, passwordHash)).toBeTrue()
        expect(await verifyPassword('a different secure password', passwordHash)).toBeFalse()
    })
})

describe('opaque authentication tokens', () => {
    test('creates random tokens and stores only deterministic SHA-256 hashes', async () => {
        const firstToken = createOpaqueToken()
        const secondToken = createOpaqueToken()
        const [firstHash, repeatedHash, secondHash] = await Promise.all([
            hashOpaqueToken(firstToken),
            hashOpaqueToken(firstToken),
            hashOpaqueToken(secondToken),
        ])

        expect(firstToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
        expect(secondToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
        expect(firstToken).not.toBe(secondToken)
        expect(firstHash).toMatch(/^[a-f0-9]{64}$/)
        expect(firstHash).toBe(repeatedHash)
        expect(firstHash).not.toBe(secondHash)
        expect(firstHash).not.toContain(firstToken)
    })
})
