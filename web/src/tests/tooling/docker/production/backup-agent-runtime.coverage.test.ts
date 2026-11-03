// oxlint-disable no-await-in-loop -- Each owned agent lifecycle and producer response must settle before the next phase.
import { afterEach, describe, expect, test } from 'bun:test'
import {
    chown,
    chmod,
    lstat,
    mkdir,
    mkdtemp,
    readFile,
    rm,
    symlink,
    writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { coverageFixtureSource } from '@/tests/Helpers/coverageFixture.ts'

const prefix = join(tmpdir(), 'rentnerproxy-agent-runtime-coverage-')
const fixtures: string[] = []
const root = fileURLToPath(new URL('../../../../../../', import.meta.url))
const ownedRootTest = test.skipIf(process.platform !== 'linux' || process.getuid?.() !== 0)
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
    await symlink(join(root, 'node_modules'), join(directory, 'node_modules'), 'dir')
    const names = ['agent.ts', 'storage.ts', 'restore.ts', 'off-host.ts']
    for (const name of names) {
        const originalFilename = 'docker/production/backups/' + name
        let source = await coverageFixtureSource(originalFilename)
        for (const [original, target] of Object.entries({
            '/var/lib/rentnerproxy': join(directory, 'state'),
            '/run/rentnerproxy': join(directory, 'runtime'),
            '/usr/share/rentnerproxy': join(directory, 'source'),
        })) {
            source = source.replaceAll(original, target)
        }
        source = source.replace(
            /((?:from|import)\s*['"])(\.[^'"]+)(['"])/gu,
            (_match: string, before: string, specifier: string, after: string) => {
                const sibling = specifier.startsWith('./') && names.includes(specifier.slice(2))
                const target = sibling
                    ? join(directory, specifier.slice(2))
                    : resolve(root, dirname(originalFilename), specifier)
                return before + pathToFileURL(target).href + after
            },
        )
        await writeFile(join(directory, name), source)
    }
    const control = join(directory, 'runtime/backups')
    const sourceDirectory = join(directory, 'source')
    await mkdir(control, { recursive: true, mode: 0o750 })
    await chown(control, 0, 10001)
    await chmod(control, 0o750)
    await mkdir(sourceDirectory)
    await writeFile(
        join(sourceDirectory, 'backup-source.json'),
        JSON.stringify({
            imageId: null,
            revision: null,
            version: 'development',
            buildSha256: 'a'.repeat(64),
        }),
        { mode: 0o600 },
    )
    return {
        directory,
        control,
        module: (await import(
            pathToFileURL(join(directory, 'agent.ts')).href
        )) as typeof import('../../../../../../docker/production/backups/agent.ts'),
    }
}

describe('owned backup agent runtime', () => {
    ownedRootTest(
        'starts a private Unix listener, persists queued work, and records producer failure without exposing secrets',
        async () => {
            const context = await fixture()
            const agent = await context.module.startBackupAgent()
            const socket = join(context.control, 'agent.sock')
            try {
                const metadata = await lstat(socket)
                expect(metadata.isSocket()).toBe(true)
                expect(metadata.gid).toBe(10001)
                expect(metadata.mode & 0o777).toBe(0o660)
                const status = await fetch('http://localhost/status', { unix: socket })
                expect(status.status).toBe(200)
                expect(await status.json()).toMatchObject({ jobs: [], offHost: { enabled: false } })
                const job = await agent.engine.start({
                    actorId: '00000000-0000-4000-8000-000000000001',
                    requestId: '00000000-0000-4000-8000-000000000002',
                })
                const processing = agent.engine.tick()
                const deadline = Date.now() + 5000
                while (!(await lstat(join(context.control, 'request.json')).catch(() => null))) {
                    if (Date.now() > deadline)
                        throw new Error('Fixture producer admission timed out.')
                    await Bun.sleep(10)
                }
                expect(
                    JSON.parse(await readFile(join(context.control, 'request.json'), 'utf8')),
                ).toEqual({ id: job.id })
                await writeFile(
                    join(context.control, 'result.json'),
                    JSON.stringify({ id: job.id, success: false, error: 'execution_failed' }),
                    { mode: 0o600 },
                )
                await processing
                expect((await agent.engine.status()).jobs[0]).toMatchObject({
                    id: job.id,
                    state: 'failed',
                    error: 'execution_failed',
                })
                const progress = JSON.parse(
                    await readFile(
                        join(context.directory, 'runtime/maintenance/progress.json'),
                        'utf8',
                    ),
                )
                expect(progress).toEqual({ maintenance: null })
            } finally {
                agent.shutdown()
            }
        },
        10_000,
    )

    ownedRootTest(
        'rejects group-writable control directories before binding a listener or starting jobs',
        async () => {
            const context = await fixture()
            await chmod(context.control, 0o770)
            await expect(context.module.startBackupAgent()).rejects.toThrow(
                'invalid backup control directory',
            )
            expect(await lstat(join(context.control, 'agent.sock')).catch(() => null)).toBeNull()
            expect(
                await lstat(join(context.directory, 'state/backups/jobs.json')).catch(() => null),
            ).toBeNull()
        },
    )
})
