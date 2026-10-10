import { describe, expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dir, '../../../../../..')
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash'
const script = join(repositoryRoot, 'docker/web/prune-build-tools.sh')

async function prune(directory: string): Promise<number> {
    const process = Bun.spawn([bash, '--noprofile', '--norc', script], {
        cwd: directory,
        stdin: 'ignore',
        stdout: 'ignore',
        stderr: 'ignore',
    })
    return process.exited
}

describe('web runtime dependency pruning', () => {
    test('removes complete tool owners including native and nested binaries, retaining runtime imports', async () => {
        const parent = join(repositoryRoot, 'tmp')
        await mkdir(parent, { recursive: true })
        const directory = await mkdtemp(join(parent, 'runtime-prune-'))
        const tools = [
            '@esbuild/linux-x64/bin/esbuild',
            '@esbuild-kit/core-utils/dist/index.js',
            'esbuild/lib/main.js',
            'tsx/node_modules/esbuild/bin/esbuild',
        ]
        const runtime = [
            '@tanstack/react-start/server.js',
            '@tanstack/start-server-core/index.js',
            'i18next/index.js',
            'drizzle-orm/index.js',
            'maxmind/index.js',
            'oxfmt/dist/index.js',
            '@oxfmt/binding-linux-x64-gnu/oxfmt.linux-x64-gnu.node',
        ]
        try {
            await Promise.all(
                [...tools, ...runtime].map(async (path) => {
                    const file = join(directory, 'node_modules', path)
                    await mkdir(resolve(file, '..'), { recursive: true })
                    await writeFile(file, 'fixture')
                }),
            )
            expect(await prune(directory)).toBe(0)
            const removed = await Promise.all(
                tools.map((path) => Bun.file(join(directory, 'node_modules', path)).exists()),
            )
            expect(removed).toEqual(tools.map(() => false))
            const preserved = await Promise.all(
                runtime.map((path) => readFile(join(directory, 'node_modules', path), 'utf8')),
            )
            expect(preserved).toEqual(runtime.map(() => 'fixture'))
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })

    test('formats HTML with only the retained production formatter packages after pruning', async () => {
        // Keep resolution outside the checkout so installed development packages cannot mask pruning.
        const directory = await mkdtemp(join(tmpdir(), 'rentnerproxy-runtime-formatter-'))
        try {
            await Promise.all(
                ['oxfmt', '@oxfmt', 'tinypool'].map((name) =>
                    cp(
                        join(repositoryRoot, 'node_modules', name),
                        join(directory, 'node_modules', name),
                        { recursive: true },
                    ),
                ),
            )
            expect(await prune(directory)).toBe(0)
            const child = Bun.spawn(
                [
                    process.execPath,
                    '--no-env-file',
                    '-e',
                    `import { strict as assert } from 'node:assert'
                     import { format } from 'oxfmt'
                     const source = '<style>h1{color:red}</style><span>one</span> <span>two</span>'
                     const result = await format('default-site.html', source, {
                         tabWidth: 4, printWidth: 100, htmlWhitespaceSensitivity: 'strict',
                     })
                     assert.deepEqual(result.errors, [])
                     assert.ok(result.code.includes('color: red;'))
                     assert.ok(result.code.includes('<span>one</span> <span>two</span>'))
                     console.log('runtime-html-format-ok')`,
                ],
                { cwd: directory, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
            )
            const [stdout, stderr, exitCode] = await Promise.all([
                new Response(child.stdout).text(),
                new Response(child.stderr).text(),
                child.exited,
            ])
            expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' })
            expect(stdout).toContain('runtime-html-format-ok')
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })

    test('rejects an incorrect working directory', async () => {
        const parent = join(repositoryRoot, 'tmp')
        await mkdir(parent, { recursive: true })
        const directory = await mkdtemp(join(parent, 'runtime-prune-'))
        try {
            expect(await prune(directory)).not.toBe(0)
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })

    test('both runtime stages invoke the same prune after the frozen production install', async () => {
        const dockerfiles = await Promise.all(
            ['docker/web/Dockerfile', 'docker/production/Dockerfile'].map((path) =>
                readFile(join(repositoryRoot, path), 'utf8'),
            ),
        )
        for (const dockerfile of dockerfiles) {
            expect(dockerfile).toContain(
                'COPY docker/web/prune-build-tools.sh /tmp/prune-build-tools.sh',
            )
            expect(dockerfile).toMatch(
                /bun install --frozen-lockfile --production\s+\\\s+&& \/bin\/sh \/tmp\/prune-build-tools\.sh\s+\\\s+&& rm \/tmp\/prune-build-tools\.sh/u,
            )
        }
    })
})
