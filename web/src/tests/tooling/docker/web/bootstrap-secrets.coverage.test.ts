import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { coverageFixtureSource } from '@/tests/Helpers/coverageFixture.ts'
import type { BootstrapSecretState } from '../../../../../../docker/web/Types/bootstrap-secrets.types.ts'

const prefix = join(tmpdir(), 'rentnerproxy-bootstrap-cli-coverage-')
const fixtures: string[] = []
afterEach(async () => {
    await Promise.all(
        fixtures.splice(0).map(async (directory) => {
            if (!resolve(directory).startsWith(resolve(prefix)))
                throw new Error('Unsafe fixture cleanup.')
            await rm(directory, { recursive: true, force: true })
        }),
    )
})

async function fixture() {
    const directory = await mkdtemp(prefix)
    fixtures.push(directory)
    const source = await coverageFixtureSource('docker/web/bootstrap-secrets.ts')
    const paths = {
        '/var/lib/rentnerproxy': join(directory, 'state'),
        '/run/rentnerproxy': join(directory, 'run'),
        '/backup/app-encryption-key': join(directory, 'exported-key/value'),
        '/restore-key/app-encryption-key': join(directory, 'restore/app-encryption-key'),
    }
    let rewritten = source
    for (const [original, replacement] of Object.entries(paths)) {
        rewritten = rewritten.replaceAll(original, replacement.replaceAll('\\', '/'))
    }
    for (const original of Object.keys(paths)) expect(rewritten.includes(original)).toBe(false)
    const entry = join(directory, 'bootstrap.ts')
    await writeFile(entry, rewritten)
    const statePath = join(directory, 'state/bootstrap/secrets-v1.json')
    const pendingPath = join(directory, 'state/bootstrap/app-key-restore-v1.json')
    const journalPath = join(directory, 'state/bootstrap/production-restore-v1.json')
    const readState = async () =>
        JSON.parse(await readFile(statePath, 'utf8')) as BootstrapSecretState
    const run = async (operation = 'initialize', environment: Record<string, string> = {}) => {
        const child = Bun.spawn([process.execPath, '--no-env-file', entry, operation], {
            env: { ...process.env, RENTNERPROXY_DATABASE_HOST: 'postgres', ...environment },
            stdout: 'pipe',
            stderr: 'pipe',
        })
        const [status, stdout, stderr] = await Promise.all([
            child.exited,
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
        ])
        return { status, output: stdout + stderr }
    }
    return { directory, statePath, pendingPath, journalPath, readState, run }
}

describe('sandboxed secret bootstrap CLI', () => {
    test.skipIf(process.platform === 'win32')(
        'initializes once, repairs materialized files, and exports a stable private application key',
        async () => {
            const context = await fixture()
            {
                const initialized = await context.run()
                expect(initialized.status, initialized.output).toBe(0)
            }
            const state = await context.readState()
            expect(state.version).toBe(1)
            expect(Buffer.from(String(state.appEncryptionKey), 'base64')).toHaveLength(32)
            expect(new URL(String(state.databaseUrl)).password).toBe(state.postgresPassword)
            {
                const initialized = await context.run()
                expect(initialized.status, initialized.output).toBe(0)
            }
            expect(await context.readState()).toEqual(state)
            const output = join(context.directory, 'run/controller-token/value')
            await chmod(output, 0o600)
            await writeFile(output, 'fixture-damaged-output')
            {
                const initialized = await context.run()
                expect(initialized.status, initialized.output).toBe(0)
            }
            expect((await readFile(output, 'utf8')).trim()).toBe(state.controllerToken)
            expect((await context.run('export-app-key')).status).toBe(0)
            const exported = join(context.directory, 'exported-key/value')
            expect(await readFile(exported, 'utf8')).toBe(state.appEncryptionKey)
            expect((await context.run('export-app-key')).status).toBe(1)
            if (process.platform !== 'win32')
                expect((await lstat(exported)).mode & 0o777).toBe(0o400)
            expect(
                (await readdir(join(context.directory, 'state/bootstrap'))).filter((name) =>
                    name.startsWith('.bootstrap-'),
                ),
            ).toEqual([])
        },
    )

    test.skipIf(process.platform === 'win32')(
        'stages, rolls back, resumes, and completes application key restores without changing other secrets',
        async () => {
            const context = await fixture()
            {
                const initialized = await context.run()
                expect(initialized.status, initialized.output).toBe(0)
            }
            const before = await context.readState()
            const restoreKey = join(context.directory, 'restore/app-encryption-key')
            await mkdir(join(context.directory, 'restore'))
            const nextKey = Buffer.alloc(32, 7).toString('base64')
            await writeFile(restoreKey, nextKey)
            expect((await context.run('begin-app-key-restore')).status).toBe(0)
            expect(await context.readState()).toEqual({ ...before, appEncryptionKey: nextKey })
            expect((await context.run()).status).toBe(1)
            expect((await context.run('begin-app-key-restore')).status).toBe(1)
            expect((await context.run('rollback-app-key-restore')).status).toBe(0)
            expect(await context.readState()).toEqual(before)
            expect((await context.run('begin-app-key-restore')).status).toBe(0)
            const restoreEnvironment = { RENTNERPROXY_RESTORE_BACKUP_ID: 'c'.repeat(64) }
            expect((await context.run('begin-production-restore', restoreEnvironment)).status).toBe(
                0,
            )
            expect((await context.run('begin-app-key-restore')).status).toBe(0)
            await writeFile(restoreKey, Buffer.alloc(32, 8).toString('base64'))
            expect((await context.run('begin-app-key-restore')).status).toBe(1)
            expect((await context.run('complete-app-key-restore')).status).toBe(0)
            expect(
                (await context.run('complete-production-restore', restoreEnvironment)).status,
            ).toBe(0)
            expect(await lstat(context.pendingPath).catch(() => null)).toBeNull()
            expect((await context.run('complete-app-key-restore')).status).toBe(1)
            expect((await context.run('rollback-app-key-restore')).status).toBe(1)
            expect(await context.readState()).toEqual({ ...before, appEncryptionKey: nextKey })
        },
    )

    test.skipIf(process.platform === 'win32')(
        'requires exact production-restore identity before recovery and rejects malformed journals',
        async () => {
            const context = await fixture()
            expect((await context.run('inspect-production-restore')).output.trim()).toBe('')
            expect((await context.run('begin-production-restore')).status).toBe(1)
            const environment = { RENTNERPROXY_RESTORE_BACKUP_ID: 'a'.repeat(64) }
            expect((await context.run('begin-production-restore', environment)).status).toBe(0)
            expect((await context.run('inspect-production-restore')).output).toContain(
                'a'.repeat(64),
            )
            expect((await context.run()).status).toBe(1)
            expect((await context.run('begin-production-restore', environment)).status).toBe(1)
            expect(
                (
                    await context.run('begin-production-restore', {
                        ...environment,
                        RENTNERPROXY_RESTORE_RESUME: 'true',
                    })
                ).status,
            ).toBe(0)
            expect(
                (
                    await context.run('begin-production-restore', {
                        RENTNERPROXY_RESTORE_BACKUP_ID: 'b'.repeat(64),
                        RENTNERPROXY_RESTORE_RESUME: 'true',
                    })
                ).status,
            ).toBe(1)
            expect((await context.run('complete-production-restore', environment)).status).toBe(0)
            expect(await lstat(context.journalPath).catch(() => null)).toBeNull()
            await writeFile(context.journalPath, '{invalid')
            expect((await context.run('inspect-production-restore')).status).toBe(1)
        },
    )

    test.each(['database', 'materialized', 'corrupt', 'invalid-host'])(
        'fails closed instead of replacing %s installation state',
        async (kind) => {
            const context = await fixture()
            if (kind === 'database') {
                const path = join(context.directory, 'state/postgres-data')
                await mkdir(path, { recursive: true })
                await writeFile(join(path, 'PG_VERSION'), 'fixture')
            } else if (kind === 'materialized') {
                const path = join(context.directory, 'run/app-key')
                await mkdir(path, { recursive: true })
                await writeFile(join(path, 'value'), 'fixture-existing-key')
            } else if (kind === 'corrupt') {
                await mkdir(join(context.directory, 'state/bootstrap'), { recursive: true })
                await writeFile(context.statePath, '{invalid')
            }
            const result = await context.run(
                'initialize',
                kind === 'invalid-host'
                    ? { RENTNERPROXY_DATABASE_HOST: 'outside.example.test' }
                    : {},
            )
            expect(result.status).toBe(1)
            expect(result.output).toContain('Runtime secret bootstrap failed:')
            if (kind === 'corrupt')
                expect(await readFile(context.statePath, 'utf8')).toBe('{invalid')
            else expect(await lstat(context.statePath).catch(() => null)).toBeNull()
        },
    )
})
