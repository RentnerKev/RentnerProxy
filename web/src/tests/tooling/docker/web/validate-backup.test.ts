import { describe, expect, test } from 'bun:test'
import { createCipheriv } from 'node:crypto'

import {
    assertSupportedBackupVersion,
    decryptBackupSecret,
    isMigrationJournal,
} from '../../../../../../docker/web/validate-backup.ts'

const fixtureKey = Buffer.alloc(32, 3)
const fixtureIv = Buffer.alloc(12, 4)
const fixtureContext = 'typed-backup-fixture'

function encryptedFixture(): Buffer {
    const cipher = createCipheriv('aes-256-gcm', fixtureKey, fixtureIv)
    cipher.setAAD(Buffer.from(fixtureContext, 'utf8'))
    return Buffer.concat([cipher.update('synthetic fixture'), cipher.final(), cipher.getAuthTag()])
}

describe('typed backup secret validation', () => {
    test('authenticates ciphertext with its original key and context', () => {
        expect(() =>
            decryptBackupSecret(fixtureKey, encryptedFixture(), fixtureIv, fixtureContext),
        ).not.toThrow()
    })

    test('rejects a different key or context', () => {
        const ciphertext = encryptedFixture()
        for (const [key, context] of [
            [Buffer.alloc(32, 5), fixtureContext],
            [fixtureKey, 'different-fixture-context'],
        ] as const) {
            expect(() => decryptBackupSecret(key, ciphertext, fixtureIv, context)).toThrow(
                'backup application key cannot decrypt persisted secrets',
            )
        }
    })

    test('rejects modified ciphertext', () => {
        const ciphertext = encryptedFixture()
        ciphertext[0] = (ciphertext[0] ?? 0) ^ 1
        expect(() =>
            decryptBackupSecret(fixtureKey, ciphertext, fixtureIv, fixtureContext),
        ).toThrow('backup application key cannot decrypt persisted secrets')
    })

    test.each([
        [Buffer.alloc(31), fixtureIv, encryptedFixture()],
        [fixtureKey, Buffer.alloc(11), encryptedFixture()],
        [fixtureKey, fixtureIv, Buffer.alloc(16)],
    ])('rejects invalid key, IV or ciphertext dimensions %#', (key, iv, ciphertext) => {
        expect(() => decryptBackupSecret(key, ciphertext, iv, fixtureContext)).toThrow(
            'invalid encrypted backup secret',
        )
    })
})

describe('typed backup journal validation', () => {
    test('accepts the fields needed to verify a migration history', () => {
        expect(
            isMigrationJournal({ entries: [{ tag: '0000_fixture', when: 1_788_000_000_000 }] }),
        ).toBe(true)
    })

    test.each([
        [null],
        [[]],
        [{ entries: 'invalid-fixture' }],
        [{ entries: [null] }],
        [{ entries: [{ tag: 1, when: 1 }] }],
        [{ entries: [{ tag: '0000_fixture', when: 'invalid-fixture' }] }],
    ])('rejects malformed journal input %#', (input) => {
        expect(isMigrationJournal(input)).toBe(false)
    })
})

describe('backup format version boundary', () => {
    test('accepts the published beta v4 format', () => {
        expect(() => assertSupportedBackupVersion({ version: 4 })).not.toThrow()
    })

    test.each([[null], [[]], [{}], [{ version: 3 }], [{ version: 5 }], [{ version: '4' }]])(
        'rejects unsupported metadata before database validation %#',
        (metadata) => {
            expect(() => assertSupportedBackupVersion(metadata)).toThrow(
                'unsupported backup metadata version (supported: v4)',
            )
        },
    )
})
