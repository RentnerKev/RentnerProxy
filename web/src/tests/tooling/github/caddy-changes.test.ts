import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import {
    affectsCaddy,
    changedPaths,
    shouldRunCaddy,
} from '../../../../../.github/scripts/ci/caddy-changes.ts'

function git(cwd: string, ...args: string[]): string {
    const result = Bun.spawnSync(['git', ...args], {
        cwd,
        env: {
            ...process.env,
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
            GIT_AUTHOR_NAME: 'CI Fixture',
            GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
            GIT_COMMITTER_NAME: 'CI Fixture',
            GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
        },
        stdout: 'pipe',
        stderr: 'pipe',
    })
    if (result.exitCode !== 0) throw new Error(result.stderr.toString())
    return result.stdout.toString().trim()
}

async function fixture(run: (directory: string, base: string) => Promise<void>) {
    const directory = await mkdtemp(join(tmpdir(), 'rentnerproxy-caddy-changes-'))
    try {
        git(directory, 'init', '--quiet')
        await mkdir(join(directory, 'core/caddy-modules/responsecache'), { recursive: true })
        await writeFile(join(directory, 'README.md'), 'fixture documentation')
        await writeFile(
            join(directory, 'core/caddy-modules/responsecache/cache.go'),
            'fixture module',
        )
        git(directory, 'add', '.')
        git(directory, 'commit', '--quiet', '-m', 'fixture base')
        await run(directory, git(directory, 'rev-parse', 'HEAD'))
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
}

function commit(directory: string): string {
    git(directory, 'add', '--all')
    git(directory, 'commit', '--quiet', '-m', 'fixture change')
    return git(directory, 'rev-parse', 'HEAD')
}

describe('conservative Caddy change detection', () => {
    test('all runtime, build, workflow and unknown inputs run the check', () => {
        for (const path of [
            'core/caddy-modules/responsecache/go.mod',
            'core/caddy-modules/responsecache/go.sum',
            'core/src/proxy/renderer.rs',
            'core/tests/private/renderer.rs',
            'docker/caddy/tooling/build.sh',
            'docker/tooling/buildinfo/verify.go',
            'docker/tooling/buildinfo/verify_test.go',
            'docker/proxy-runtime/Dockerfile',
            'docker/proxy-runtime/Dockerfile.dockerignore',
            '.dockerignore',
            'bun.lock',
            'package.json',
            '.github/workflows/ci.yml',
            '.github/scripts/ci/caddy-changes.ts',
            'scripts/smoke/proxy/upstream.ts',
            'web/src/server/fixture.tsx',
            'web/src/shared/fixture.ts',
            'web/src/tests/tooling/github/caddy-build.test.ts',
            'web/src/tests/tooling/fixture.tsx',
            'new-unreviewed-area/fixture',
        ])
            expect(affectsCaddy(path), path).toBe(true)
    })

    test('only known documentation and presentation changes can skip', () => {
        for (const path of [
            'README.md',
            'docs/architecture.md',
            'web/src/features/Hosts/Components/HostCard.tsx',
            'web/src/styles.css',
            'web/public/logo.svg',
        ])
            expect(affectsCaddy(path), path).toBe(false)
        expect(shouldRunCaddy('push', '', '')).toBe(true)
        expect(shouldRunCaddy('workflow_dispatch', '', '')).toBe(true)
    })

    test('irrelevant PR changes skip but an added runtime input runs', async () => {
        await fixture(async (directory, base) => {
            await writeFile(join(directory, 'README.md'), 'updated documentation')
            expect(shouldRunCaddy('pull_request', base, commit(directory), directory)).toBe(false)
            const added = join(directory, 'docker/caddy/tooling/new input.sh')
            await mkdir(dirname(added), { recursive: true })
            await writeFile(added, 'fixture')
            expect(shouldRunCaddy('pull_request', base, commit(directory), directory)).toBe(true)
        })
    })

    test('a deleted runtime input runs', async () => {
        await fixture(async (directory, base) => {
            await rm(join(directory, 'core/caddy-modules/responsecache/cache.go'))
            const head = commit(directory)
            expect(changedPaths(base, head, directory)).toContain(
                'core/caddy-modules/responsecache/cache.go',
            )
            expect(shouldRunCaddy('pull_request', base, head, directory)).toBe(true)
        })
    })

    test('rename from runtime to documentation preserves the relevant old path', async () => {
        await fixture(async (directory, base) => {
            await mkdir(join(directory, 'docs'))
            await rename(
                join(directory, 'core/caddy-modules/responsecache/cache.go'),
                join(directory, 'docs/cache.md'),
            )
            const head = commit(directory)
            expect(changedPaths(base, head, directory)).toEqual([
                'core/caddy-modules/responsecache/cache.go',
                'docs/cache.md',
            ])
            expect(shouldRunCaddy('pull_request', base, head, directory)).toBe(true)
        })
    })

    test('rename into runtime includes the new path', async () => {
        await fixture(async (directory, base) => {
            await rename(join(directory, 'README.md'), join(directory, 'core/new-input.rs'))
            const head = commit(directory)
            expect(changedPaths(base, head, directory)).toContain('core/new-input.rs')
            expect(shouldRunCaddy('pull_request', base, head, directory)).toBe(true)
        })
    })

    test('compares the PR from its merge base when the base branch advances', async () => {
        await fixture(async (directory, base) => {
            await writeFile(join(directory, 'README.md'), 'PR documentation')
            const head = commit(directory)
            git(directory, 'checkout', '--detach', base)
            await writeFile(join(directory, 'core/base-only.rs'), 'base branch change')
            const advancedBase = commit(directory)
            expect(changedPaths(advancedBase, head, directory)).toEqual(['README.md'])
            expect(shouldRunCaddy('pull_request', advancedBase, head, directory)).toBe(false)
        })
    })

    test('invalid, absent and unrelated Git comparisons fail instead of skipping', async () => {
        await fixture(async (directory, base) => {
            expect(() => shouldRunCaddy('pull_request', '', base, directory)).toThrow(
                'Invalid comparison revision',
            )
            expect(() => changedPaths('--output=unexpected', base, directory)).toThrow()
            expect(() => changedPaths('a'.repeat(40), base, directory)).toThrow('Cannot resolve')
            git(directory, 'checkout', '--orphan', 'unrelated')
            await writeFile(join(directory, 'README.md'), 'unrelated documentation')
            const unrelated = commit(directory)
            expect(() => changedPaths(base, unrelated, directory)).toThrow('Cannot resolve')
        })
    })
})
