import { expect, test } from 'bun:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, rm, writeFile, copyFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
    CI_GATE_ERROR,
    REQUIRED_CI_JOBS,
    REQUIRED_COMPATIBILITY_JOBS,
} from '../../../../../.github/scripts/release/verify-exact-revision-ci.ts'

import {
    POLICY_SOURCE_ERROR,
    POLICY_SOURCE_PATHS,
    verifyCompatibilityPolicySource,
} from '../../../../../.github/scripts/release/verify-compatibility-policy-source.ts'

const root = resolve(import.meta.dir, '../../../../..')

test('both reusable workflow permission boundaries grant actions read and match the actual CI job names', async () => {
    const entry = (await readFile(join(root, '.github/workflows/release.yml'), 'utf8')).replaceAll(
        '\r\n',
        '\n',
    )
    const pipeline = (
        await readFile(join(root, '.github/workflows/release-pipeline.yml'), 'utf8')
    ).replaceAll('\r\n', '\n')
    expect(entry.slice(entry.indexOf('    release:\n'))).toMatch(
        /permissions:\s+actions: read\s+contents: write/,
    )
    expect(pipeline.slice(pipeline.indexOf('    publish:\n'))).toMatch(
        /permissions:\s+actions: read\s+contents: write/,
    )
    const ci = await readFile(join(root, '.github/workflows/ci.yml'), 'utf8')
    expect([...ci.matchAll(/^ {8}name: (.+)\r?$/gm)].map((match) => match[1]?.trim())).toEqual([
        ...REQUIRED_CI_JOBS,
    ])
})

test('CLI fails with one sanitized error and no credential output before any API request', async () => {
    const child = Bun.spawn(
        [
            process.execPath,
            '--no-env-file',
            join(root, '.github/scripts/release/verify-exact-revision-ci.ts'),
        ],
        {
            env: {
                ...process.env,
                GITHUB_REPOSITORY: 'invalid/repository',
                RELEASE_REVISION: 'a'.repeat(40),
                GH_TOKEN: 'SYNTHETIC-SECRET-DO-NOT-PRINT',
            },
            stdout: 'pipe',
            stderr: 'pipe',
        },
    )
    const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ])
    expect(code).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toBe(`::error::${CI_GATE_ERROR}\n`)
})

test('trusted checkout CLI loads with only native Bun and its byte helper, without node_modules', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rentnerproxy-ci-standalone-'))
    try {
        const scripts = join(directory, '.github/scripts/release')
        const http = join(directory, 'web/src/lib/Http')
        await Promise.all([
            mkdir(join(scripts, 'Types'), { recursive: true }),
            mkdir(http, { recursive: true }),
        ])
        await Promise.all([
            copyFile(
                join(root, '.github/scripts/release/verify-exact-revision-ci.ts'),
                join(scripts, 'verify-exact-revision-ci.ts'),
            ),
            copyFile(
                join(root, '.github/scripts/release/Types/exact-revision-ci.types.ts'),
                join(scripts, 'Types/exact-revision-ci.types.ts'),
            ),
            copyFile(
                join(root, 'web/src/lib/Http/readBoundedStream.ts'),
                join(http, 'readBoundedStream.ts'),
            ),
        ])
        const preload = join(directory, 'fixture-fetch.ts')
        await writeFile(
            preload,
            `
            const run = { id: 20, run_number: 2, run_attempt: 3, workflow_id: 10,
                path: '.github/workflows/ci.yml', repository: { full_name: 'RentnerKev/RentnerProxy' },
                head_repository: { full_name: 'RentnerKev/RentnerProxy' }, head_sha: '${'a'.repeat(40)}',
                head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success' }
            globalThis.fetch = async input => {
                const path = new URL(String(input)).pathname
                const compatibility = { ...run, id: 40, workflow_id: 30, path: '.github/workflows/release-compatibility.yml' }
                if (path.endsWith('/release-compatibility.yml')) return Response.json({ id: 30, path: compatibility.path, state: 'active' })
                if (path.includes('/workflows/30/runs')) return Response.json({ total_count: 1, workflow_runs: [compatibility] })
                if (path.includes('/runs/40/') && path.endsWith('/jobs')) return Response.json({ total_count: 1, jobs: [{ id: 1, run_id: 40, head_sha: run.head_sha, name: ${JSON.stringify(REQUIRED_COMPATIBILITY_JOBS[0])}, status: 'completed', conclusion: 'success' }] })
                if (path.endsWith('/runs/40')) return Response.json(compatibility)
                if (path.endsWith('/ci.yml')) return Response.json({ id: 10, path: run.path, state: 'active' })
                if (path.endsWith('/jobs')) return Response.json({ total_count: ${REQUIRED_CI_JOBS.length}, jobs: ${JSON.stringify(REQUIRED_CI_JOBS)}.map((name, index) => ({ id: index + 1, run_id: 20, head_sha: run.head_sha, name, status: 'completed', conclusion: 'success' })) })
                if (path.endsWith('/runs')) return Response.json({ total_count: 1, workflow_runs: [run] })
                return Response.json(run)
            }
        `,
        )
        const child = Bun.spawn(
            [
                process.execPath,
                '--no-env-file',
                '--preload',
                preload,
                join(scripts, 'verify-exact-revision-ci.ts'),
            ],
            {
                cwd: directory,
                env: {
                    ...process.env,
                    GITHUB_REPOSITORY: 'RentnerKev/RentnerProxy',
                    RELEASE_REVISION: 'a'.repeat(40),
                    GH_TOKEN: 'fixture-token',
                },
                stdout: 'pipe',
                stderr: 'pipe',
            },
        )
        const [stdout, stderr, code] = await Promise.all([
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
            child.exited,
        ])
        expect(code).toBe(0)
        expect(stdout).toBe('')
        expect(stderr).toBe('')
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})

test.skipIf(process.platform === 'win32').each([
    { gate: 0, policy: 0, finalIdentityFails: false, exit: 0 },
    { gate: 1, policy: 0, finalIdentityFails: false, exit: 1 },
    { gate: 0, policy: 0, finalIdentityFails: true, exit: 1 },
    { gate: 0, policy: 1, finalIdentityFails: false, exit: 1 },
])(
    'publisher %j controls JSON generation and upload after identity verification',
    async (scenario) => {
        const directory = await mkdtemp(join(tmpdir(), 'rentnerproxy-ci-gate-'))
        try {
            const bin = join(directory, 'bin')
            const scripts = join(directory, 'scripts')
            const runner = join(directory, 'runner')
            await Promise.all([
                mkdir(bin),
                mkdir(scripts),
                mkdir(join(runner, 'rentnerproxy-release'), { recursive: true }),
            ])
            await Promise.all(
                ['publish-release-readiness.sh', 'verify-release-identity.sh'].map((name) =>
                    copyFile(join(root, '.github/scripts/release', name), join(scripts, name)),
                ),
            )
            await writeFile(
                join(bin, 'gh'),
                `#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "$1" == api ]]; then
    printf 'identity\\n' >> "$FIXTURE_EVENTS"
    if [[ "$FIXTURE_FINAL_IDENTITY_FAIL" == true && -f "$FIXTURE_GATE_PASSED" ]]; then exit 1; fi
    printf '123\\tv1.0.0\\tfalse\\tfalse\\t2026-10-22T00:00:00Z\\n'
elif [[ "$1" == release && "$2" == upload ]]; then
    printf 'upload\\n' >> "$FIXTURE_EVENTS"
else exit 9; fi
`,
                { mode: 0o700 },
            )
            await writeFile(
                join(bin, 'bun'),
                `#!/usr/bin/env bash
set -Eeuo pipefail
[[ "$1" == --no-env-file ]]
case "$2" in
    */verify-exact-revision-ci.ts) printf 'gate\\n' >> "$FIXTURE_EVENTS"; if [[ "$FIXTURE_GATE_EXIT" == 0 ]]; then : > "$FIXTURE_GATE_PASSED"; fi; exit "$FIXTURE_GATE_EXIT" ;;
    */verify-compatibility-policy-source.ts) printf 'policy\\n' >> "$FIXTURE_EVENTS"; exit "$FIXTURE_POLICY_EXIT" ;;
    */generate-release-readiness.ts) printf 'generate\\n' >> "$FIXTURE_EVENTS"; printf '{}' > "$RUNNER_TEMP/rentnerproxy-release/rentnerproxy-update.json" ;;
    *) exit 9 ;;
esac
`,
                { mode: 0o700 },
            )
            const events = join(directory, 'events')
            const child = Bun.spawn(['bash', join(scripts, 'publish-release-readiness.sh')], {
                env: {
                    ...process.env,
                    PATH: bin + ':' + process.env.PATH,
                    RUNNER_TEMP: runner,
                    FIXTURE_EVENTS: events,
                    FIXTURE_GATE_EXIT: String(scenario.gate),
                    FIXTURE_POLICY_EXIT: String(scenario.policy),
                    FIXTURE_FINAL_IDENTITY_FAIL: String(scenario.finalIdentityFails),
                    FIXTURE_GATE_PASSED: join(directory, 'gate-passed'),
                    GITHUB_REPOSITORY: 'RentnerKev/RentnerProxy',
                    GH_TOKEN: 'SYNTHETIC-SECRET-DO-NOT-PRINT',
                    RELEASE_ID: '123',
                    RELEASE_TAG: 'v1.0.0',
                    RELEASE_PRERELEASE: 'false',
                    RELEASE_PUBLISHED_AT: '2026-10-22T00:00:00Z',
                },
                stdout: 'pipe',
                stderr: 'pipe',
            })
            const [stdout, stderr, code] = await Promise.all([
                new Response(child.stdout).text(),
                new Response(child.stderr).text(),
                child.exited,
            ])
            expect(code, stderr).toBe(scenario.exit)
            expect(stdout + stderr).not.toContain('SYNTHETIC-SECRET')
            expect(await readFile(events, 'utf8')).toBe(
                scenario.exit === 0
                    ? 'identity\ngate\nidentity\npolicy\ngenerate\nupload\n'
                    : scenario.finalIdentityFails
                      ? 'identity\ngate\nidentity\n'
                      : scenario.policy !== 0
                        ? 'identity\ngate\nidentity\npolicy\n'
                        : 'identity\ngate\n',
            )
            const asset = join(runner, 'rentnerproxy-release/rentnerproxy-update.json')
            if (scenario.exit === 0) expect(await readFile(asset, 'utf8')).toBe('{}')
            else await expect(access(asset)).rejects.toThrow()
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    },
)

test.each([
    ...[
        'equal',
        'missing',
        'oversized',
        'stale-revision',
        'short-revision',
        'working-tree-changed',
    ].map((mode) => ({ mode, changedPath: POLICY_SOURCE_PATHS[0] as string })),
    ...POLICY_SOURCE_PATHS.map((changedPath) => ({ mode: 'changed', changedPath })),
])(
    'policy provenance verifies all committed contract dependencies: %j',
    async ({ mode, changedPath }) => {
        const directory = await mkdtemp(join(tmpdir(), 'rentnerproxy-policy-source-'))
        try {
            const source = join(directory, 'source')
            const trusted = join(directory, 'trusted')
            const policy = 'export const profile = { generation: 1 } as const\n'
            await Promise.all(
                POLICY_SOURCE_PATHS.map(async (path) => {
                    await mkdir(dirname(join(source, path)), { recursive: true })
                    await mkdir(dirname(join(trusted, path)), { recursive: true })
                    await writeFile(join(trusted, path), policy)
                    if (mode !== 'missing' || path !== changedPath)
                        await writeFile(
                            join(source, path),
                            path === changedPath && mode === 'changed'
                                ? policy.replace('1', '2')
                                : path === changedPath && mode === 'oversized'
                                  ? 'x'.repeat(65_537)
                                  : policy,
                        )
                }),
            )
            const execute = promisify(execFile)
            const git = (...args: string[]) =>
                execute(
                    'git',
                    [
                        '-C',
                        source,
                        '-c',
                        'core.autocrlf=false',
                        '-c',
                        'core.hooksPath=/dev/null',
                        ...args,
                    ],
                    { windowsHide: true },
                )
            await git('init')
            await git('add', '.')
            await git(
                '-c',
                'user.name=Fixture',
                '-c',
                'user.email=fixture@example.invalid',
                'commit',
                '--no-gpg-sign',
                '-m',
                'fixture',
            )
            const revision = (await git('rev-parse', 'HEAD')).stdout.trim()
            if (mode === 'working-tree-changed')
                await writeFile(
                    join(source, changedPath),
                    'throw new Error("Target code must never execute")',
                )
            if (mode === 'equal' || mode === 'working-tree-changed')
                await verifyCompatibilityPolicySource(source, revision, trusted)
            else
                await expect(
                    verifyCompatibilityPolicySource(
                        source,
                        mode === 'stale-revision'
                            ? 'a'.repeat(40)
                            : mode === 'short-revision'
                              ? revision.slice(0, 7)
                              : revision,
                        trusted,
                    ),
                ).rejects.toThrow(POLICY_SOURCE_ERROR)
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    },
    10_000,
)

test('policy provenance CLI sanitizes missing source failures without credential output', async () => {
    const child = Bun.spawn(
        [
            process.execPath,
            '--no-env-file',
            join(root, '.github/scripts/release/verify-compatibility-policy-source.ts'),
        ],
        {
            env: {
                ...process.env,
                GITHUB_WORKSPACE: '',
                GH_TOKEN: 'SYNTHETIC-SECRET-DO-NOT-PRINT',
            },
            stdout: 'pipe',
            stderr: 'pipe',
        },
    )
    const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ])
    expect(code).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toBe(`::error::${POLICY_SOURCE_ERROR}\n`)
})
