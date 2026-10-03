import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'bun:test'

import { packageMigrations } from '../../../../../../docker/web/package-migrations.ts'

const temporaryDirectories: string[] = []
const fixtureSql = 'CREATE TABLE fixture (id integer);\n--> statement-breakpoint\nSELECT 1;\n'
const journal = {
    version: '7',
    dialect: 'postgresql',
    entries: [
        { idx: 0, version: '7', when: 1787946234573, tag: '0000_fixture', breakpoints: true },
    ],
}
const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')

afterEach(async () => {
    await Promise.all(
        temporaryDirectories
            .splice(0)
            .map((directory) => rm(directory, { force: true, recursive: true })),
    )
})

async function fixture(sql: string | Buffer = fixtureSql, metadata: unknown = journal) {
    const root = await mkdtemp(join(tmpdir(), 'rentnerproxy-migration-packaging-'))
    temporaryDirectories.push(root)
    const source = join(root, 'source')
    const output = join(root, 'output')
    await mkdir(join(source, 'meta'), { recursive: true })
    await writeFile(join(source, 'meta', '_journal.json'), JSON.stringify(metadata, null, 4) + '\n')
    await writeFile(join(source, '0000_fixture.sql'), sql)
    return { root, source, output }
}

describe('deterministic migration image packaging', () => {
    test.each(['LF', 'CRLF', 'mixed'])(
        '%s build context preserves historical LF hashes',
        async (eol) => {
            const sql =
                eol === 'LF'
                    ? fixtureSql
                    : eol === 'CRLF'
                      ? fixtureSql.replaceAll('\n', '\r\n')
                      : 'CREATE TABLE fixture (id integer);\r\n--> statement-breakpoint\nSELECT 1;\n'
            const { source, output } = await fixture(sql)
            const metadataPath = join(source, 'meta', '_journal.json')
            const originalJournal = (await readFile(metadataPath, 'utf8')).replaceAll('\n', '\r\n')
            await writeFile(metadataPath, originalJournal)
            await packageMigrations(source, output)

            const packaged = await readFile(join(output, '0000_fixture.sql'))
            expect(packaged.toString('utf8')).toBe(fixtureSql)
            expect(digest(packaged)).toBe(digest(fixtureSql))
            expect(await readFile(join(source, '0000_fixture.sql'), 'utf8')).toBe(sql)
            expect(await readFile(metadataPath, 'utf8')).toBe(originalJournal)
            expect(await readFile(join(output, 'meta', '_journal.json'), 'utf8')).toBe(
                originalJournal.replaceAll('\r\n', '\n'),
            )
        },
    )

    test('changed SQL remains a different raw hash after CRLF packaging', async () => {
        const modified = fixtureSql.replace('SELECT 1', 'SELECT 2').replaceAll('\n', '\r\n')
        const { source, output } = await fixture(modified)
        await packageMigrations(source, output)
        expect(digest(await readFile(join(output, '0000_fixture.sql')))).not.toBe(
            digest(fixtureSql),
        )
    })

    test('preserves UTF8, BOM, whitespace, and an absent final newline byte for byte', async () => {
        const original = '\uFEFF-- Grüße\nSELECT 1;  '
        const { source, output } = await fixture(original.replaceAll('\n', '\r\n'))
        await packageMigrations(source, output)
        expect(digest(await readFile(join(output, '0000_fixture.sql')))).toBe(digest(original))
    })

    test.each([Buffer.from([0xff]), Buffer.from('SELECT 1;\r')])(
        'rejects invalid UTF8 and unsupported bare carriage returns',
        async (sql) => {
            const { source, output } = await fixture(sql)
            await expect(packageMigrations(source, output)).rejects.toThrow()
        },
    )

    test.each([
        {},
        { entries: [] },
        { entries: [{ tag: '../outside' }] },
        { entries: [{ tag: '0000_fixture' }, { tag: '0000_fixture' }] },
    ])('rejects missing, empty, unsafe, and duplicate journal entries', async (metadata) => {
        const { source, output } = await fixture(fixtureSql, metadata)
        await expect(packageMigrations(source, output)).rejects.toThrow()
    })

    test('missing migration files fail before producing a package', async () => {
        const { source, output } = await fixture(fixtureSql, {
            entries: [{ tag: '0001_missing' }],
        })
        await expect(packageMigrations(source, output)).rejects.toThrow()
        await expect(readFile(join(output, 'meta', '_journal.json'))).rejects.toThrow()
    })

    test('rejects malformed journal JSON before producing a package', async () => {
        const { source, output } = await fixture()
        await writeFile(join(source, 'meta', '_journal.json'), '{')
        await expect(packageMigrations(source, output)).rejects.toThrow()
        await expect(readFile(join(output, 'meta', '_journal.json'))).rejects.toThrow()
    })

    test('rejects existing output and overlapping source/output directories', async () => {
        const { source, output } = await fixture()
        await mkdir(output)
        await writeFile(join(output, 'keep.txt'), 'keep')
        await expect(packageMigrations(source, output)).rejects.toThrow()
        expect(await readFile(join(output, 'keep.txt'), 'utf8')).toBe('keep')
        await expect(packageMigrations(source, source)).rejects.toThrow()
        await expect(packageMigrations(source, join(source, 'output'))).rejects.toThrow()
    })

    test('rejects directory symlinks instead of following another source', async () => {
        const { root, source, output } = await fixture()
        const linkedSource = join(root, 'linked-source')
        await symlink(source, linkedSource, process.platform === 'win32' ? 'junction' : 'dir')
        await expect(packageMigrations(linkedSource, output)).rejects.toThrow()
    })

    test('rejects output parents that alias the source directory', async () => {
        const { root, source } = await fixture()
        const alias = join(root, 'source-alias')
        await symlink(source, alias, process.platform === 'win32' ? 'junction' : 'dir')
        await expect(packageMigrations(source, join(alias, 'output'))).rejects.toThrow()
    })
})
