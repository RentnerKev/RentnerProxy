import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
    assertInitialSecretGenerationAllowed,
    hasMaterializedSecrets,
} from '../../../../../../docker/web/bootstrap-secrets.ts'

const fixturePrefix = join(tmpdir(), 'rentnerproxy-bootstrap-typed-')
const temporaryDirectories: string[] = []

afterEach(async () => {
    await Promise.all(
        temporaryDirectories.splice(0).map(async (directory) => {
            if (!directory.startsWith(fixturePrefix))
                throw new Error('Invalid fixture cleanup path')
            await rm(directory, { recursive: true, force: true })
        }),
    )
})

async function fixtureDirectory(): Promise<string> {
    const directory = await mkdtemp(fixturePrefix)
    temporaryDirectories.push(directory)
    return directory
}

describe('typed runtime secret file detection', () => {
    test('uses the full byte limit for each file instead of the array index', async () => {
        const directory = await fixtureDirectory()
        const first = join(directory, 'first-fixture')
        const second = join(directory, 'second-fixture')
        await writeFile(first, 'synthetic-fixture-value'.repeat(8))

        expect(await hasMaterializedSecrets([first, second])).toBe(true)
    })

    test('reports absent files without creating persistent state', async () => {
        const directory = await fixtureDirectory()
        expect(await hasMaterializedSecrets([join(directory, 'missing-fixture')])).toBe(false)
    })

    test.each([
        ['oversized', Buffer.alloc(4_097, 1)],
        ['NUL-containing', Buffer.from('synthetic\0fixture')],
    ] as const)('rejects %s files', async (_name, bytes) => {
        const path = join(await fixtureDirectory(), 'invalid-fixture')
        await writeFile(path, bytes)
        await expect(hasMaterializedSecrets([path])).rejects.toThrow(
            'invalid persistent runtime secret file',
        )
    })

    test('rejects a directory used as a secret file', async () => {
        const path = join(await fixtureDirectory(), 'directory-fixture')
        await mkdir(path)
        await expect(hasMaterializedSecrets([path])).rejects.toThrow(
            'invalid persistent runtime secret file',
        )
    })
})

describe('initial secret generation safety', () => {
    test('permits fresh installation without a database or materialized secrets', () => {
        expect(() => assertInitialSecretGenerationAllowed(false, false)).not.toThrow()
    })

    test.each([
        [true, false],
        [false, true],
        [true, true],
    ])(
        'rejects existing installation state instead of replacing its keys %#',
        (database, secrets) => {
            expect(() => assertInitialSecretGenerationAllowed(database, secrets)).toThrow(
                'secrets-v1.json is missing for an existing installation',
            )
            expect(() => assertInitialSecretGenerationAllowed(database, secrets)).toThrow(
                'supported beta.1 installation',
            )
            expect(() => assertInitialSecretGenerationAllowed(database, secrets)).toThrow(
                'legacy environment secret import is no longer supported',
            )
        },
    )
})
