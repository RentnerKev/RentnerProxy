import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { copyCoverageFixtureModules } from '@/tests/Helpers/coverageFixture.ts'

test('backup build identity is deterministic, responds to deployed content changes and never overwrites an existing receipt', async () => {
    const parent = resolve(import.meta.dir, '../../../../../../tmp/backup-build-identity-tests')
    await mkdir(parent, { recursive: true })
    const directory = await mkdtemp(join(parent, 'run-'))
    if (dirname(directory) !== parent)
        throw new Error('Unexpected build identity fixture directory.')
    const path = (name: string) => join(directory, name).replaceAll('\\', '/')
    const receipt = path('receipt/backup-source.json')
    const inputs = [
        'bin/rentnerproxy-controller',
        'bin/rentnerproxy-production',
        'lib/rentnerproxy-backups.sh',
        'web/backup-agent.js',
        'web/backup-export.js',
        'web/migrate.js',
        'web/web/dist/server/index.js',
        'web/web/dist/client/app.js',
        'web/web/drizzle/0001.sql',
    ]
    try {
        for (const name of new Set(inputs.map((input) => dirname(path(input))))) {
            // eslint-disable-next-line no-await-in-loop -- Windows recursive mkdir cannot safely race overlapping parents
            await mkdir(name, { recursive: true })
        }
        await Promise.all(
            inputs.map((name) => writeFile(path(name), 'synthetic immutable runtime: ' + name)),
        )
        await mkdir(dirname(receipt), { recursive: true })
        await copyCoverageFixtureModules(
            directory,
            ['docker/production/backups/build-identity.ts'],
            {
                '/opt/rentnerproxy/web': path('web'),
                '/usr/local/bin': path('bin'),
                '/usr/local/lib': path('lib'),
                '/usr/share/rentnerproxy/backup-source.json': receipt,
            },
        )
        const run = async () => {
            const child = Bun.spawn(
                [
                    process.execPath,
                    '--no-env-file',
                    join(directory, 'docker/production/backups/build-identity.ts'),
                ],
                {
                    env: {
                        ...process.env,
                        RENTNERPROXY_BUILD_VERSION: '1.2.3-test',
                        RENTNERPROXY_BUILD_REVISION: 'a'.repeat(40),
                    },
                    stdin: 'ignore',
                    stdout: 'pipe',
                    stderr: 'pipe',
                },
            )
            const [code, stderr] = await Promise.all([
                child.exited,
                new Response(child.stderr).text(),
            ])
            return { code, stderr }
        }
        expect(await run()).toEqual({ code: 0, stderr: '' })
        const first = JSON.parse(await readFile(receipt, 'utf8')) as Record<string, unknown>
        expect(first).toMatchObject({
            imageId: null,
            revision: 'a'.repeat(40),
            version: '1.2.3-test',
            buildSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        })
        const existing = await run()
        expect(existing.code).toBe(1)
        expect(existing.stderr).toContain('EEXIST')
        expect(JSON.parse(await readFile(receipt, 'utf8'))).toEqual(first)
        await rm(receipt)
        expect((await run()).code).toBe(0)
        expect(JSON.parse(await readFile(receipt, 'utf8'))).toEqual(first)
        await rm(receipt)
        await writeFile(path('web/web/dist/client/app.js'), 'changed deployed client content')
        expect((await run()).code).toBe(0)
        const changed = JSON.parse(await readFile(receipt, 'utf8')) as Record<string, unknown>
        expect(changed.buildSha256).not.toBe(first.buildSha256)
        expect(changed.revision).toBe(first.revision)
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})
