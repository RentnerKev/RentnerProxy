import { describe, expect, test } from 'bun:test'
import { createCipheriv, createHash } from 'node:crypto'

import {
    assertCompatibleBackupHistory,
    assertSupportedBackupVersion,
    decryptBackupSecret,
    isMigrationJournal,
} from '../../../../../../docker/web/validate-backup.ts'
import type {
    BackupMigrationJournal,
    BackupMigrationRow,
} from '../../../../../../docker/web/Types/validate-backup.types.ts'

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

describe('compatible backup migration prefixes', () => {
    const migrations = [
        { tag: 'fixture_beta_base', when: 1_788_000_000_000, sql: 'select 1;\n' },
        { tag: 'fixture_beta_saved_state', when: 1_788_000_001_000, sql: 'select 2;\n' },
        { tag: 'fixture_later_target', when: 1_788_000_002_000, sql: 'select 3;\n' },
    ] as const
    const journal: BackupMigrationJournal = {
        entries: migrations.map(({ tag, when }) => ({ tag, when })),
    }
    const rows: BackupMigrationRow[] = migrations.map(({ sql, when }) => ({
        hash: createHash('sha256').update(sql).digest('hex'),
        created_at: String(when),
    }))
    const readMigration = (tag: string): Promise<Uint8Array> => {
        const migration = migrations.find((entry) => entry.tag === tag)
        if (!migration) throw new Error('Unexpected synthetic migration')
        return Promise.resolve(Buffer.from(migration.sql))
    }

    test('accepts a shorter v4 beta baseline without reading the later target suffix', async () => {
        assertSupportedBackupVersion({ version: 4 })
        const requested: string[] = []
        await assertCompatibleBackupHistory(rows.slice(0, 2), journal, (tag) => {
            requested.push(tag)
            return readMigration(tag)
        })
        expect(requested).toEqual(['fixture_beta_base', 'fixture_beta_saved_state'])
    })

    test('continues to accept the complete target history and numeric timestamps', async () => {
        await expect(
            assertCompatibleBackupHistory(
                rows.map((row) => ({ ...row, created_at: BigInt(row.created_at) })),
                journal,
                readMigration,
            ),
        ).resolves.toBeUndefined()
    })

    test.each([
        ['empty', []],
        ['longer than the target', [...rows, rows[0]!]],
    ] as const)('rejects %s history before loading SQL', async (_label, input) => {
        const requested: string[] = []
        await expect(
            assertCompatibleBackupHistory(input, journal, (tag) => {
                requested.push(tag)
                return readMigration(tag)
            }),
        ).rejects.toThrow('unsupported backup database version')
        expect(requested).toEqual([])
    })

    test.each([
        ['modified hash', [{ ...rows[0]!, hash: '0'.repeat(64) }]],
        ['modified timestamp', [{ ...rows[0]!, created_at: migrations[0].when + 1 }]],
        ['reordered entries', [rows[1]!, rows[0]!]],
        ['missing middle entry', [rows[0]!, rows[2]!]],
        ['duplicate entry', [rows[0]!, rows[0]!]],
    ] as const)('rejects a %s', async (_label, input) => {
        await expect(assertCompatibleBackupHistory(input, journal, readMigration)).rejects.toThrow(
            'backup migration history is incompatible with the target image',
        )
    })

    test('rejects SQL content that no longer matches the stored hash', async () => {
        await expect(
            assertCompatibleBackupHistory(rows.slice(0, 1), journal, () =>
                Promise.resolve(Buffer.from('select 999;\n')),
            ),
        ).rejects.toThrow('backup migration history is incompatible with the target image')
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
