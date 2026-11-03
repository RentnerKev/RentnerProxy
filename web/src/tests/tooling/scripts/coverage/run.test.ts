import { expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { coverageSourceRoots } from '../../../../../../scripts/coverage/coverage.config.ts'
import { parseCoverageSummary } from '../../../../../../scripts/coverage/summary.ts'

test('the real coverage CLI fails assertions even at 100 percent and removes stale published success on invalid invocation', async () => {
    const repository = resolve(import.meta.dir, '../../../../../..')
    const parent = join(repository, 'tmp/coverage-runner-tests')
    await mkdir(parent, { recursive: true })
    const directory = await mkdtemp(join(parent, 'run-'))
    if (dirname(directory) !== parent) throw new Error('Unexpected runner fixture directory.')
    try {
        await Promise.all(
            coverageSourceRoots.map((path) =>
                path.endsWith('.ts')
                    ? writeFile(join(directory, path), 'export type Declaration = string')
                    : mkdir(join(directory, path), { recursive: true }),
            ),
        )
        await cp(join(repository, 'scripts/coverage'), join(directory, 'scripts/coverage'), {
            recursive: true,
        })
        await symlink(
            join(repository, 'node_modules'),
            join(directory, 'node_modules'),
            process.platform === 'win32' ? 'junction' : 'dir',
        )
        const filenames = [
            'web/src/features/fixture.ts',
            'web/src/lib/fixture.ts',
            'web/src/server/Auth/fixture.ts',
            'web/src/server/Backups/fixture.ts',
            'scripts/fixture-source.ts',
        ]
        await Promise.all(
            filenames.map(async (filename) => {
                await mkdir(dirname(join(directory, filename)), { recursive: true })
                await writeFile(join(directory, filename), 'export function checked() { return 1 }')
            }),
        )
        const tests = join(directory, 'web/src/tests')
        await mkdir(tests)
        await writeFile(
            join(tests, 'failure.test.ts'),
            [
                'import {test,expect} from "bun:test"',
                ...filenames.map(
                    (filename, index) =>
                        `import {checked as checked${index}} from "../../../${filename}"`,
                ),
                `test("all sources execute, then an assertion fails",()=>{ ${filenames.map((_, index) => `expect(checked${index}()).toBe(1);`).join('')} expect(1).toBe(2) })`,
            ].join('\n'),
        )
        const run = async (args: string[]) => {
            const child = Bun.spawn(
                [
                    process.execPath,
                    '--no-env-file',
                    join(directory, 'scripts/coverage/run.ts'),
                    ...args,
                ],
                {
                    cwd: directory,
                    env: { ...process.env, BUN_OPTIONS: '', RENTNERPROXY_COVERAGE_MANIFEST: '' },
                    stdin: 'ignore',
                    stdout: 'pipe',
                    stderr: 'pipe',
                },
            )
            const [code, stdout, stderr] = await Promise.all([
                child.exited,
                new Response(child.stdout).text(),
                new Response(child.stderr).text(),
            ])
            return { code, output: stdout + stderr }
        }
        const failed = await run([])
        expect(failed.code).toBe(1)
        expect(failed.output).toContain('all sources execute, then an assertion fails')
        const output = join(directory, 'coverage/typescript')
        const summary = JSON.parse(await readFile(join(output, 'summary.json'), 'utf8')) as {
            testExitCode: number
            groups: { lines: { percent: number }; functions: { percent: number } }[]
        }
        expect(summary.testExitCode).toBe(1)
        expect(summary.groups).toHaveLength(7)
        for (const group of summary.groups) {
            expect(group.lines.percent).toBe(100)
            expect(group.functions.percent).toBe(100)
        }
        expect(() => parseCoverageSummary(summary, 'typescript')).toThrow('tests failed')
        expect((await run(['--unsupported'])).code).toBe(1)
        await Promise.all(
            ['summary.json', 'summary.md', 'coverage.json', 'sources.json'].map((name) =>
                expect(readFile(join(output, name))).rejects.toThrow('ENOENT'),
            ),
        )
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
}, 30_000)
