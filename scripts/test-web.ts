import { readdir } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const testRoot = resolve(repositoryRoot, 'web/src/tests')
const mode = process.argv[2] ?? '--unit'
if (!['--unit', '--database', '--fuzz'].includes(mode)) {
    throw new Error('Expected --unit, --database, or --fuzz.')
}
if (mode === '--database' && process.env.RENTNERPROXY_DATABASE_INTEGRATION !== '1') {
    throw new Error(
        'Database tests require an explicitly configured isolated integration database.',
    )
}

async function collectTests(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true })
    const files = await Promise.all(
        entries.map((entry) => {
            const path = resolve(directory, entry.name)
            return entry.isDirectory() ? collectTests(path) : Promise.resolve([path])
        }),
    )
    return files.flat().filter((path) => /\.test\.tsx?$/u.test(path))
}

const tests = (await collectTests(testRoot))
    .filter((path) => {
        if (mode === '--database') return path.endsWith('.db.test.ts')
        if (mode === '--fuzz') return path.endsWith('.fuzz.test.ts')
        return !path.endsWith('.db.test.ts') && !path.endsWith('.fuzz.test.ts')
    })
    .toSorted()
if (tests.length === 0) throw new Error('No matching web tests found.')

const child = Bun.spawn(
    [
        process.execPath,
        '--no-env-file',
        'test',
        '--max-concurrency=1',
        '--isolate',
        ...tests.map((path) => `./${relative(repositoryRoot, path).replaceAll('\\', '/')}`),
    ],
    {
        cwd: repositoryRoot,
        env:
            mode === '--unit' && !process.env.DATABASE_URL
                ? {
                      ...process.env,
                      // Unit modules construct a lazy SQL client; their probes are injected.
                      DATABASE_URL: 'postgresql://unit:unit@127.0.0.1:1/rentnerproxy_unit',
                  }
                : process.env,
        stdin: 'inherit',
        stdout: 'inherit',
        stderr: 'inherit',
    },
)
process.exitCode = await child.exited
