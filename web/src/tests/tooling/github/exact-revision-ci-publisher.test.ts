import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile, copyFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
    CI_GATE_ERROR,
    REQUIRED_CI_JOBS,
} from '../../../../../.github/scripts/release/verify-exact-revision-ci.ts'

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
                if (path.endsWith('/ci.yml')) return Response.json({ id: 10, path: run.path, state: 'active' })
                if (path.endsWith('/jobs')) return Response.json({ total_count: 7, jobs: ${JSON.stringify(REQUIRED_CI_JOBS)}.map((name, index) => ({ id: index + 1, run_id: 20, head_sha: run.head_sha, name, status: 'completed', conclusion: 'success' })) })
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
    { gate: 0, finalIdentityFails: false, exit: 0 },
    { gate: 1, finalIdentityFails: false, exit: 1 },
    { gate: 0, finalIdentityFails: true, exit: 1 },
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
                    ? 'identity\ngate\nidentity\ngenerate\nupload\n'
                    : scenario.finalIdentityFails
                      ? 'identity\ngate\nidentity\n'
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
