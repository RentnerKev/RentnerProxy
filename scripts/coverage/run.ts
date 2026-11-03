import { appendFile, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { coverageThreshold } from './coverage.config.ts'
import { assertCoverageSourcesUnchanged, createCoverageBaseline } from './sources.ts'
import { clearPublishedCoverage } from './published.ts'
import { remapTypescriptCoverage } from './original.ts'
import {
    coverageFailures,
    formatCoverageResults,
    mergeTypescriptCoverage,
    typescriptCoverageResults,
} from './report.ts'

async function collectTests(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true })
    return (
        await Promise.all(
            entries.map((entry) =>
                entry.isDirectory()
                    ? collectTests(join(directory, entry.name))
                    : Promise.resolve([join(directory, entry.name)]),
            ),
        )
    )
        .flat()
        .filter((path) => /\.test\.tsx?$/u.test(path))
}

export async function runTypescriptCoverage(args: string[] = []): Promise<number> {
    const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))
    const output = resolve(repositoryRoot, 'coverage/typescript')
    await clearPublishedCoverage(output, true)
    if (args.length > 1 || (args.length === 1 && args[0] !== '--database'))
        throw new Error('Expected coverage:ts [--database].')
    const database = args[0] === '--database'
    if (database) {
        const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null
        if (
            process.env.RENTNERPROXY_DATABASE_INTEGRATION !== '1' ||
            url?.hostname !== '127.0.0.1' ||
            url.pathname !== '/rentnerproxy_upstream_test'
        )
            throw new Error(
                'Database coverage requires the explicitly enabled disposable loopback test database.',
            )
    }
    const run = await mkdtemp(join(output, 'run-'))
    const cacheDirectory = join(run, 'instrumented')
    const { baseline, excluded, hashes, sourceMaps } = await createCoverageBaseline(
        repositoryRoot,
        cacheDirectory,
    )
    const files = Object.keys(baseline)
    const manifest = join(run, 'manifest.json')
    await writeFile(
        manifest,
        JSON.stringify({ repositoryRoot, outputDirectory: run, cacheDirectory, files }),
    )
    await writeFile(join(run, 'baseline.json'), JSON.stringify(baseline))
    await writeFile(join(run, 'source-maps.json'), JSON.stringify(sourceMaps))
    await writeFile(
        join(output, 'sources.json'),
        JSON.stringify({ files, hashes, excluded }, null, 2),
    )
    const tests = (await collectTests(join(repositoryRoot, 'web/src/tests')))
        .filter((path) => database || !path.endsWith('.db.test.ts'))
        .toSorted()
    const child = Bun.spawn(
        [
            process.execPath,
            '--no-env-file',
            'test',
            '--max-concurrency=1',
            '--isolate',
            '--preload',
            join(repositoryRoot, 'scripts/coverage/preload.ts'),
            ...tests,
        ],
        {
            cwd: repositoryRoot,
            stdin: 'inherit',
            stdout: 'inherit',
            stderr: 'inherit',
            env: {
                ...process.env,
                RENTNERPROXY_COVERAGE_MANIFEST: manifest,
                BUN_OPTIONS:
                    '--preload=' + join(repositoryRoot, 'scripts/coverage/child-preload.ts'),
                DATABASE_URL: database
                    ? process.env.DATABASE_URL!
                    : 'postgresql://unit:unit@127.0.0.1:1/rentnerproxy_unit',
                RENTNERPROXY_DATABASE_INTEGRATION: database ? '1' : '0',
                RENTNERPROXY_VALKEY_INTEGRATION: database
                    ? (process.env.RENTNERPROXY_VALKEY_INTEGRATION ?? '0')
                    : '0',
                ...(!database ? { VALKEY_URL: 'redis://127.0.0.1:1' } : {}),
            },
        },
    )
    const status = await child.exited
    await assertCoverageSourcesUnchanged(repositoryRoot, hashes)
    const raw = join(run, 'raw')
    const snapshots = await Promise.all(
        (await readdir(raw))
            .filter((name) => name.endsWith('.json'))
            .toSorted()
            .map(async (name) => JSON.parse(await readFile(join(raw, name), 'utf8')) as unknown),
    )
    const merged = await remapTypescriptCoverage(
        mergeTypescriptCoverage(baseline, snapshots),
        sourceMaps,
        repositoryRoot,
    )
    const groups = typescriptCoverageResults(merged)
    const summary = { version: 1, minimum: coverageThreshold, groups, testExitCode: status }
    await writeFile(join(output, 'coverage.json'), JSON.stringify(merged.toJSON()))
    await writeFile(join(output, 'summary.json'), JSON.stringify(summary, null, 2))
    const text = formatCoverageResults(groups)
    await writeFile(join(output, 'summary.md'), text)
    console.log(text)
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, text)
    const failures = coverageFailures(groups)
    for (const failure of failures) console.error(failure)
    return status !== 0 || failures.length !== 0 ? 1 : 0
}

if (import.meta.main) process.exitCode = await runTypescriptCoverage(process.argv.slice(2))
