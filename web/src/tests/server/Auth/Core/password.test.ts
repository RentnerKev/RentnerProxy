import { describe, expect, test } from 'bun:test'

import {
    hashPassword,
    isValidPassword,
    isValidNewPassword,
} from '@/server/Auth/Core/password.server.ts'
import { createOpaqueToken, hashOpaqueToken } from '@/server/Auth/Core/tokens.server.ts'

const PASSWORD = 'correct horse battery staple'

describe('password hashing', () => {
    test.each([0, 1, 257])(
        'rejects a new password of %i characters before hashing',
        async (length) => {
            const password = 'x'.repeat(length)
            expect(isValidNewPassword(password)).toBeFalse()
            await expect(hashPassword(password)).rejects.toMatchObject({ code: 'password_policy' })
        },
    )
    test.each([
        { label: 'one Unicode code point', password: '😀' },
        { label: 'over the UTF-16 maximum', password: '😀'.repeat(129) },
    ])('rejects $label before hashing', async ({ password }) => {
        expect(isValidNewPassword(password)).toBeFalse()
        await expect(hashPassword(password)).rejects.toMatchObject({ code: 'password_policy' })
    })
    test.each([
        { label: 'minimum', password: 'x'.repeat(2) },
        { label: 'Unicode minimum', password: '😀'.repeat(2) },
        { label: 'maximum', password: 'x'.repeat(256) },
        { label: 'UTF-16 maximum', password: '😀'.repeat(128) },
    ])('hashes and verifies the $label password boundary', async ({ password }) => {
        expect(isValidNewPassword(password)).toBeTrue()
        expect(await Bun.password.verify(password, await hashPassword(password))).toBeTrue()
    })

    test('accepts any non-empty password within the technical size limit', () => {
        expect(isValidPassword('x')).toBeTrue()
        expect(isValidPassword(' ')).toBeTrue()
        expect(isValidPassword('😀'.repeat(6))).toBeTrue()
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

        expect(await Bun.password.verify(PASSWORD, passwordHash)).toBeTrue()
        expect(await Bun.password.verify('a different secure password', passwordHash)).toBeFalse()
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
