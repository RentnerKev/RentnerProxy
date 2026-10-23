import { describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, writeFile, rm, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { webSocketProbeScript } from '../../../../../.github/scripts/ci/release-compatibility/websocket-probe.ts'
import { assertFreshExternalDefaults } from '../../../../../.github/scripts/ci/release-compatibility/state.ts'
import {
    prepareTargetSource,
    immutableImageId,
} from '../../../../../.github/scripts/ci/release-compatibility/source-identity.ts'
import {
    assertHistoricalImports,
    copyHistoricalZod,
} from '../../../../../.github/scripts/ci/release-compatibility/historical-dependencies.ts'

async function capture(args: string[], cwd?: string) {
    const process = Bun.spawn(args, {
        ...(cwd ? { cwd } : {}),
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const timer = setTimeout(() => process.kill(), 5_000)
    try {
        const [exitCode, stdout, stderr] = await Promise.all([
            process.exited,
            new Response(process.stdout).text(),
            new Response(process.stderr).text(),
        ])
        return { exitCode, stdout, stderr }
    } finally {
        clearTimeout(timer)
    }
}

describe('compatibility external-defaults diagnostics', () => {
    test.each([
        ['disabled', 'external-mutations-disabled'],
        ['ddns-http', 'ddns-http-503'],
        ['discovery-http', 'discovery-http-401'],
        ['ddns-configured', 'ddns-configured'],
        ['discovery-enabled', 'discovery-not-disabled'],
    ] as const)('reports only a fixed status for %s', async (mode, expected) => {
        let reported = ''
        const fixtureValue = 'private-fixture-value-must-not-appear'
        const command = async (args: string[]) => {
            if (!args.includes('bun')) {
                expect(args.at(-1)).toContain('psql')
                return '0'
            }
            expect(args.slice(-2, -1)).toEqual(['-e'])
            const source = [
                `Bun.file=()=>({text:async()=>${JSON.stringify(fixtureValue)}});`,
                `const mode=${JSON.stringify(mode)};const fixtureValue=${JSON.stringify(fixtureValue)};`,
                "globalThis.fetch=async(url)=>{const ddns=url.endsWith('/ddns/status');const code=ddns&&mode==='ddns-http'?503:!ddns&&mode==='discovery-http'?401:200;const configuration=ddns?(mode==='ddns-configured'?{credential:fixtureValue}:null):{settings:{enabled:mode==='discovery-enabled'}};return Response.json({configuration,private:fixtureValue},{status:code});};",
                args.at(-1)!,
            ].join('')
            const result = await capture([process.execPath, '--no-env-file', '-e', source])
            expect(result.exitCode).toBe(0)
            expect(result.stderr).toBe('')
            expect(result.stdout).toBe(expected)
            expect(result.stdout).not.toContain(fixtureValue)
            reported = result.stdout
            return result.stdout
        }
        if (mode === 'disabled') await assertFreshExternalDefaults(command, 'fixture-container')
        else
            await expect(assertFreshExternalDefaults(command, 'fixture-container')).rejects.toThrow(
                expected,
            )
        expect(reported).toBe(expected)
    })
})

describe('compatibility WebSocket evidence', () => {
    test.each(['marker', 'empty-close', 'wrong-message', 'timeout', 'http-error'] as const)(
        'requires the marker from a controlled %s receiver',
        async (mode) => {
            const server = Bun.serve({
                hostname: '127.0.0.1',
                port: 0,
                fetch(request, receiver) {
                    if (mode === 'http-error') return new Response('unavailable', { status: 503 })
                    if (receiver.upgrade(request)) return
                    return new Response('upgrade required', { status: 426 })
                },
                websocket: {
                    open(socket) {
                        if (mode === 'marker') socket.send('expected-fixture-marker')
                        if (mode === 'wrong-message') socket.send('unexpected-fixture-marker')
                        if (mode === 'empty-close') socket.close(1000)
                    },
                    message() {},
                },
            })
            try {
                const result = await capture([
                    process.execPath,
                    '--no-env-file',
                    '-e',
                    webSocketProbeScript({
                        url: `ws://127.0.0.1:${server.port}/probe`,
                        expectedMessage: 'expected-fixture-marker',
                        timeoutMs: 300,
                    }),
                ])
                expect(result.exitCode).toBe(mode === 'marker' ? 0 : 1)
                expect(result.stdout).toBe(mode === 'marker' ? 'websocket-ok' : '')
            } finally {
                await server.stop(true)
            }
        },
    )
})

describe('compatibility source identity', () => {
    test('validates immutable image IDs instead of accepting a mutable tag', () => {
        expect(immutableImageId('sha256:' + 'a'.repeat(64))).toBe('sha256:' + 'a'.repeat(64))
        expect(() => immutableImageId('rentnerproxy:compat-latest')).toThrow('identity')
        expect(() => immutableImageId('sha256:short')).toThrow('identity')
    })
    test('archives the exact clean commit, excludes ignored inputs and rejects tracked or untracked edits', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'rp-compat-identity-'))
        try {
            const repository = join(directory, 'repository')
            const output = join(directory, 'output')
            await mkdir(repository)
            await mkdir(output)
            const command = async (args: string[]) => {
                const result = await capture(args, repository)
                if (result.exitCode !== 0) throw new Error('fixture command failed')
                return result.stdout.trim()
            }
            await command(['git', 'init', '--quiet'])
            await writeFile(join(repository, 'tracked.txt'), 'committed source')
            await writeFile(join(repository, '.gitignore'), 'ignored.txt\n')
            await command(['git', 'add', '.'])
            await command([
                'git',
                '-c',
                `core.hooksPath=${join(directory, 'no-hooks')}`,
                '-c',
                'commit.gpgsign=false',
                '-c',
                'user.name=Compatibility Fixture',
                '-c',
                'user.email=compatibility@fixture.invalid',
                'commit',
                '--quiet',
                '-m',
                'fixture',
            ])
            await writeFile(join(repository, 'ignored.txt'), 'must never enter the build')
            const source = await prepareTargetSource(command, output)
            expect(source.revision).toBe(await command(['git', 'rev-parse', 'HEAD']))
            expect(await readFile(join(source.context, 'tracked.txt'), 'utf8')).toBe(
                'committed source',
            )
            expect(await Bun.file(join(source.context, 'ignored.txt')).exists()).toBeFalse()
            await writeFile(join(repository, 'tracked.txt'), 'dirty source')
            await expect(prepareTargetSource(command, output)).rejects.toThrow(
                'clean committed checkout',
            )
            expect(await readFile(join(source.context, 'tracked.txt'), 'utf8')).toBe(
                'committed source',
            )
            await command(['git', 'restore', 'tracked.txt'])
            await writeFile(join(repository, 'untracked.txt'), 'uncommitted source')
            await expect(prepareTargetSource(command, output)).rejects.toThrow(
                'clean committed checkout',
            )
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })
})

describe('historical compatibility dependencies', () => {
    test('allows only the pinned local import closure and copied Zod package', () => {
        const paths = ['scripts/backup/validation.ts', 'scripts/backup/format.ts']
        expect(() =>
            assertHistoricalImports(
                "import { z } from 'zod'; import { createHash } from 'node:crypto'; import './validation.ts'",
                paths[1]!,
                paths,
            ),
        ).not.toThrow()
        expect(() =>
            assertHistoricalImports("import missing from './missing.ts'", paths[1]!, paths),
        ).toThrow('unsupported historical tool import')
        expect(() =>
            assertHistoricalImports(
                "import dependency from 'unexpected-package'",
                paths[1]!,
                paths,
            ),
        ).toThrow('unsupported historical tool import')
        expect(() =>
            assertHistoricalImports(
                "const dependency = import('unexpected-package')",
                paths[1]!,
                paths,
            ),
        ).toThrow('unsupported historical tool import')
    })
    test('copies only Zod into a usable ordinary directory without symlinks or modifying installed packages', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'rp-compat-zod-'))
        try {
            const installed = resolve(import.meta.dir, '../../../../../node_modules/zod')
            const before = await readFile(join(installed, 'package.json'), 'utf8')
            const copied = await copyHistoricalZod(installed, directory)
            expect((await lstat(copied)).isSymbolicLink()).toBeFalse()
            const probe = await capture(
                [
                    process.execPath,
                    '--no-env-file',
                    '-e',
                    "import { z } from 'zod'; z.literal('copied-zod').parse('copied-zod'); process.stdout.write('copied-zod-ok')",
                ],
                directory,
            )
            expect(probe.exitCode).toBe(0)
            expect(probe.stdout).toBe('copied-zod-ok')
            expect(await readFile(join(installed, 'package.json'), 'utf8')).toBe(before)
            expect(
                await Bun.file(join(directory, 'node_modules/drizzle-orm/package.json')).exists(),
            ).toBeFalse()
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })
})
