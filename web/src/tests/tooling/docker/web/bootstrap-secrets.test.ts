// oxlint-disable no-await-in-loop -- Verify each rejected state leaves the same private file untouched.
import { afterEach, describe, expect, test } from 'bun:test'
import {
    chmod,
    link,
    lstat,
    mkdtemp,
    mkdir,
    readFile,
    readdir,
    rm,
    symlink,
    writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
    assertInitialSecretGenerationAllowed,
    beginProductionRestore,
    hasMaterializedSecrets,
    pauseOffHostBackupsAfterRestore,
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

function offHostState() {
    return {
        version: 1,
        configuration: {
            revision: 9,
            enabled: true,
            configured: true,
            endpoint: 'https://storage.example.test',
            region: 'test-1',
            bucket: 'fixture-backup',
            prefix: 'fixture/prefix',
            targetId: '00000000-0000-4000-8000-000000000001',
            keyId: 'a'.repeat(64),
        },
        sealed: {
            iv: 'opaque-synthetic-iv',
            ciphertext: 'opaque-synthetic-ciphertext-never-decrypted',
        },
        receipts: [
            {
                state: 'succeeded',
                targetId: '00000000-0000-4000-8000-000000000001',
                keyId: 'a'.repeat(64),
                objectKey: 'target/newer-backup.rpbk',
                sha256: 'b'.repeat(64),
                bytes: 100,
                verifiedAt: 1234,
            },
        ],
        requests: [{ id: '00000000-0000-4000-8000-000000000002', fingerprint: 'c'.repeat(64) }],
    }
}

describe('production restore off-host pause hook', () => {
    test.each([false, true])(
        'fresh or matching resumed restore (resume: %s) pauses before returning',
        async (resume) => {
            const calls: string[] = []
            await beginProductionRestore('a'.repeat(64), {
                readJournal: async () => (resume ? { version: 1, backupId: 'a'.repeat(64) } : null),
                writeJournal: async () => {
                    calls.push('journal')
                },
                pauseOffHost: async () => {
                    calls.push('pause')
                },
                resume,
            })
            expect(calls).toEqual(resume ? ['pause'] : ['journal', 'pause'])
        },
    )

    test.each([false, true])(
        'pause errors fail closed on fresh and resumed restores (resume: %s)',
        async (resume) => {
            let paused = false
            await expect(
                beginProductionRestore('a'.repeat(64), {
                    readJournal: async () =>
                        resume ? { version: 1, backupId: 'a'.repeat(64) } : null,
                    writeJournal: async () => {},
                    pauseOffHost: async () => {
                        paused = true
                        throw new Error('fixture pause failure')
                    },
                    resume,
                }),
            ).rejects.toThrow('fixture pause failure')
            expect(paused).toBe(true)
        },
    )

    test('a mismatched resume never changes off-host configuration', async () => {
        let paused = false
        await expect(
            beginProductionRestore('a'.repeat(64), {
                readJournal: async () => ({ version: 1, backupId: 'b'.repeat(64) }),
                writeJournal: async () => {
                    throw new Error('must not write')
                },
                pauseOffHost: async () => {
                    paused = true
                },
                resume: true,
            }),
        ).rejects.toThrow('same backup')
        expect(paused).toBe(false)
    })
})

const rootRuntime = process.platform !== 'win32' && process.getuid?.() === 0

describe('durable root-owned off-host restore pause', () => {
    test.skipIf(!rootRuntime)(
        'restore pause preserves the actor-bound pending audit for later exact-once recovery',
        async () => {
            const directory = await fixtureDirectory()
            await chmod(directory, 0o700)
            const path = join(directory, 'off-host.json')
            const state = offHostState()
            const actorId = '00000000-0000-4000-8000-000000000003'
            const pendingAudit = {
                requestId: state.requests[0]!.id,
                actorId,
                fingerprint: state.requests[0]!.fingerprint,
            }
            const initial = {
                ...state,
                requests: [
                    { id: pendingAudit.requestId, fingerprint: pendingAudit.fingerprint, actorId },
                ],
                pendingAudit,
            }
            await writeFile(path, JSON.stringify(initial), { mode: 0o600 })
            await pauseOffHostBackupsAfterRestore(path)
            expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
                ...initial,
                configuration: { ...initial.configuration, enabled: false, revision: 10 },
            })
            expect(await readdir(directory)).toEqual(['off-host.json'])
        },
    )

    test.skipIf(!rootRuntime).each([false, true])(
        'same-key restore preserves opaque credentials and newer receipts (resume: %s)',
        async (resume) => {
            const directory = await fixtureDirectory()
            await chmod(directory, 0o700)
            const path = join(directory, 'off-host.json')
            const initial = offHostState()
            await writeFile(path, JSON.stringify(initial), { mode: 0o600 })
            await beginProductionRestore('a'.repeat(64), {
                readJournal: async () => (resume ? { version: 1, backupId: 'a'.repeat(64) } : null),
                writeJournal: async () => {},
                pauseOffHost: () => pauseOffHostBackupsAfterRestore(path),
                resume,
            })
            const persisted = JSON.parse(await readFile(path, 'utf8'))
            expect(persisted).toEqual({
                ...initial,
                configuration: { ...initial.configuration, enabled: false, revision: 10 },
            })
            expect((await lstat(path)).uid).toBe(0)
            expect((await lstat(path)).mode & 0o777).toBe(0o600)
            expect(await readdir(directory)).toEqual(['off-host.json'])
            await pauseOffHostBackupsAfterRestore(path)
            expect(JSON.parse(await readFile(path, 'utf8')).configuration).toEqual({
                ...initial.configuration,
                enabled: false,
                revision: 11,
            })
        },
    )

    test.skipIf(!rootRuntime)(
        'missing off-host configuration or backup directory is a no-op',
        async () => {
            const directory = await fixtureDirectory()
            await pauseOffHostBackupsAfterRestore(join(directory, 'off-host.json'))
            await pauseOffHostBackupsAfterRestore(join(directory, 'missing', 'off-host.json'))
            expect(await readdir(directory)).toEqual([])
        },
    )

    test.skipIf(!rootRuntime)(
        'malformed, oversized or invalid public/sealed state remains untouched on failure',
        async () => {
            const directory = await fixtureDirectory()
            const path = join(directory, 'off-host.json')
            const state = offHostState()
            const actorId = '00000000-0000-4000-8000-000000000003'
            const pendingAudit = {
                requestId: state.requests[0]!.id,
                actorId,
                fingerprint: state.requests[0]!.fingerprint,
            }
            const pendingState = {
                ...state,
                requests: [
                    { id: pendingAudit.requestId, fingerprint: pendingAudit.fingerprint, actorId },
                ],
                pendingAudit,
            }
            const invalid = [
                '',
                '{malformed fixture',
                ' '.repeat(512 * 1024 + 1),
                JSON.stringify({ ...state, extra: true }),
                JSON.stringify({
                    ...state,
                    configuration: { ...state.configuration, enabled: 'true' },
                }),
                JSON.stringify({
                    ...state,
                    configuration: { ...state.configuration, revision: Number.MAX_SAFE_INTEGER },
                }),
                JSON.stringify({
                    ...state,
                    sealed: { iv: 'fixture', ciphertext: 'fixture', decryptedSecret: 'forbidden' },
                }),
                JSON.stringify({
                    ...state,
                    receipts: [{ ...state.receipts[0], objectKey: '\nunsafe' }],
                }),
                JSON.stringify({ ...pendingState, pendingAudit: null }),
                JSON.stringify({
                    ...pendingState,
                    pendingAudit: { requestId: pendingAudit.requestId },
                }),
                JSON.stringify({ ...state, pendingAudit }),
                JSON.stringify({
                    ...pendingState,
                    pendingAudit: { ...pendingAudit, actorId: state.configuration.targetId },
                }),
                JSON.stringify({
                    ...pendingState,
                    pendingAudit: { ...pendingAudit, fingerprint: 'd'.repeat(64) },
                }),
                JSON.stringify({
                    ...pendingState,
                    pendingAudit: { ...pendingAudit, recoveryKey: 'must-not-be-accepted' },
                }),
            ]
            for (const bytes of invalid) {
                await writeFile(path, bytes, { mode: 0o600 })
                await expect(pauseOffHostBackupsAfterRestore(path)).rejects.toThrow(
                    'could not be paused',
                )
                expect(await readFile(path, 'utf8')).toBe(bytes)
                expect(await readdir(directory)).toEqual(['off-host.json'])
            }
        },
    )

    test.skipIf(!rootRuntime)(
        'unsafe permissions, hard links and symbolic links fail closed without replacement',
        async () => {
            const directory = await fixtureDirectory()
            const path = join(directory, 'off-host.json')
            const bytes = JSON.stringify(offHostState())
            await writeFile(path, bytes, { mode: 0o600 })
            await chmod(path, 0o640)
            await expect(pauseOffHostBackupsAfterRestore(path)).rejects.toThrow(
                'could not be paused',
            )
            await chmod(path, 0o600)
            const alias = join(directory, 'alias')
            await link(path, alias)
            await expect(pauseOffHostBackupsAfterRestore(path)).rejects.toThrow(
                'could not be paused',
            )
            expect(await readFile(path, 'utf8')).toBe(bytes)
            await rm(path)
            await symlink(alias, path)
            await expect(pauseOffHostBackupsAfterRestore(path)).rejects.toThrow(
                'could not be paused',
            )
            expect(await readFile(alias, 'utf8')).toBe(bytes)
        },
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
