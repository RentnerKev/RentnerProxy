import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { describe, expect, test } from 'bun:test'

const root = resolve(import.meta.dir, '../../../../..')
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash'
const revision = 'a'.repeat(40)
const digest = 'sha256:' + createHash('sha256').update('fixture-manifest').digest('hex')
const prefix = 'rentnerproxy-image-scope-'
const advisory = JSON.stringify({
    'fixture-package': [
        {
            id: 123,
            title: 'Synthetic own dependency advisory',
            url: 'https://example.org/advisories/fixture',
            severity: 'high',
            vulnerable_versions: '<1.0.1',
        },
    ],
})

function shellPath(path: string): string {
    const normalized = path.replaceAll('\\', '/')
    return process.platform === 'win32'
        ? normalized.replace(/^([a-z]):\//iu, (_match, drive: string) => `/${drive.toLowerCase()}/`)
        : normalized
}

describe('own image dependency gate and informational upstream diagnostics', () => {
    for (const scenario of [
        { name: 'clean own dependencies with upstream findings', upstream: 3, expected: 0 },
        {
            name: 'clean own dependencies with unavailable upstream tools',
            upstream: 1,
            expected: 0,
        },
        {
            name: 'clean own dependencies with an unexpected upstream exit',
            upstream: 17,
            expected: 0,
        },
        { name: 'all assessments clean', upstream: 0, expected: 0 },
        { name: 'own Cargo advisory with clean upstream', cargo: 3, upstream: 0, expected: 3 },
        {
            name: 'incomplete own Cargo audit with upstream findings',
            cargo: 1,
            upstream: 3,
            expected: 1,
        },
        {
            name: 'own Bun advisory with upstream findings',
            bun: 1,
            report: advisory,
            upstream: 3,
            expected: 3,
        },
        { name: 'inconsistent own Bun evidence', report: advisory, upstream: 0, expected: 1 },
        {
            name: 'incomplete own Bun coverage',
            diagnostics: 'warning: skipped registry',
            upstream: 3,
            expected: 1,
        },
        {
            name: 'unexpected own Bun scanner exit',
            bun: 3,
            report: advisory,
            upstream: 0,
            expected: 1,
        },
    ]) {
        test(scenario.name, async () => {
            const directory = await mkdtemp(join(tmpdir(), prefix))
            if (dirname(directory) !== resolve(tmpdir()) || !basename(directory).startsWith(prefix))
                throw new Error('Unexpected owned image fixture directory')
            const tools = join(directory, 'tools')
            const automation = join(directory, 'automation/.github/scripts/security')
            await Promise.all([
                mkdir(tools),
                mkdir(automation, { recursive: true }),
                mkdir(join(directory, 'reports')),
            ])
            const config = JSON.stringify({
                os: 'linux',
                architecture: 'amd64',
                config: { Labels: { 'org.opencontainers.image.revision': revision } },
            })
            await Promise.all([
                writeFile(join(directory, 'reports/assessment.json'), '{"verdict":"stale"}'),
                writeFile(
                    join(directory, 'reports/blocked-assessment.json'),
                    '{"verdict":"stale"}',
                ),
                writeFile(
                    join(tools, 'skopeo'),
                    `#!/bin/bash
if [[ "$*" == *--raw* ]]; then printf fixture-manifest
elif [[ "$*" == *--config* ]]; then printf '%s' "$CONFIG"
elif [[ "$1" != copy ]]; then exit 91
fi
`,
                    { mode: 0o755 },
                ),
                writeFile(
                    join(tools, 'docker'),
                    `#!/bin/bash
case "$1" in
    load) exit 0 ;;
    create) printf fixture-container ;;
    cp)
        printf fixture-lock-data > "$3"
        if [[ "$3" == */web/package.json ]]; then printf FIXTURE_SECRET=synthetic > "\${3%/*}/.env"; fi
        ;;
    rm) printf cleanup >> "$TOOL_LOG" ;;
    *) exit 91 ;;
esac
`,
                    { mode: 0o755 },
                ),
                writeFile(
                    join(tools, 'bun'),
                    `#!/bin/bash
if [[ "$1" == --no-env-file && "$2" == audit ]]; then
    if [[ -f .env ]]; then echo 'unexpected deployment configuration loaded' >&2; exit 1; fi
    printf '%s' "$BUN_REPORT"
    printf '%s' "$BUN_DIAGNOSTICS" >&2
    exit "$BUN_EXIT"
fi
shift 2
exec "$REAL_BUN" --no-env-file "$REAL_POLICY" "$@"
`,
                    { mode: 0o755 },
                ),
                writeFile(
                    join(tools, 'jq'),
                    '#!/bin/bash\nexec "$REAL_BUN" --no-env-file jq-fixture.ts "$@"\n',
                    { mode: 0o755 },
                ),
                writeFile(
                    join(directory, 'jq-fixture.ts'),
                    `const args = process.argv.slice(2)
if (args.includes('--null-input')) {
    const revision = args[args.indexOf('revision') + 1]
    const digest = args[args.indexOf('digest') + 1]
    console.log(JSON.stringify({ revision, digest }))
} else {
    const input = await Bun.file(args.at(-1)!).json()
    if (args.includes('--raw-output')) console.log(input.cargoLockSourcePath)
    else process.exit(Number(input.os !== 'linux' || input.architecture !== 'amd64' || input.config?.Labels?.['org.opencontainers.image.revision'] !== process.env.REVISION))
}
`,
                ),
                writeFile(join(automation, 'audit-cargo.sh'), '#!/bin/bash\nexit "$CARGO_EXIT"\n', {
                    mode: 0o755,
                }),
                writeFile(
                    join(automation, 'audit-bun.sh'),
                    await readFile(join(root, '.github/scripts/security/audit-bun.sh'), 'utf8'),
                    { mode: 0o755 },
                ),
                writeFile(
                    join(automation, 'scan-upstream.sh'),
                    '#!/bin/bash\nprintf upstream >> "$TOOL_LOG"\nexit "$UPSTREAM_EXIT"\n',
                    { mode: 0o755 },
                ),
            ])
            try {
                const child = Bun.spawn(
                    [
                        bash,
                        '--noprofile',
                        '--norc',
                        '-c',
                        'export PATH="$TOOL_DIRECTORY:/usr/bin:/bin"; chmod +x "$TOOL_DIRECTORY"/*; exec bash "$SCAN_SCRIPT"',
                    ],
                    {
                        cwd: directory,
                        env: {
                            PATH: '/usr/bin:/bin',
                            TOOL_DIRECTORY: shellPath(tools),
                            SCAN_SCRIPT: shellPath(
                                join(root, '.github/scripts/security/scan-image.sh'),
                            ),
                            AUTOMATION_DIRECTORY: 'automation',
                            IMAGE_SOURCE: 'oci-archive:fixture-image.tar',
                            REVISION: revision,
                            REPORT_DIRECTORY: 'reports',
                            RUNNER_TEMP: '.',
                            CONFIG: config,
                            CARGO_EXIT: String('cargo' in scenario ? scenario.cargo : 0),
                            BUN_EXIT: String('bun' in scenario ? scenario.bun : 0),
                            BUN_REPORT: 'report' in scenario ? scenario.report : '{}',
                            BUN_DIAGNOSTICS: 'diagnostics' in scenario ? scenario.diagnostics : '',
                            UPSTREAM_EXIT: String(scenario.upstream),
                            REAL_BUN: shellPath(process.execPath),
                            REAL_POLICY: shellPath(
                                join(root, '.github/scripts/security/dependency-policy.ts'),
                            ),
                            TOOL_LOG: 'calls',
                            GITHUB_STEP_SUMMARY: 'summary.md',
                            GITHUB_OUTPUT: 'outputs',
                        },
                        stdout: 'pipe',
                        stderr: 'pipe',
                        stdin: 'ignore',
                    },
                )
                const [stdout, stderr, result] = await Promise.all([
                    new Response(child.stdout).text(),
                    new Response(child.stderr).text(),
                    child.exited,
                ])
                expect(result, `${stdout}\n${stderr}`).toBe(scenario.expected)
                expect(await readFile(join(directory, 'calls'), 'utf8')).toBe('upstreamcleanup')
                expect(await readFile(join(directory, 'reports/upstream-status.txt'), 'utf8')).toBe(
                    `${scenario.upstream}\n`,
                )
                const approved = Bun.file(join(directory, 'reports/assessment.json'))
                const blocked = Bun.file(join(directory, 'reports/blocked-assessment.json'))
                expect(await approved.exists()).toBe(scenario.expected === 0)
                expect(await blocked.exists()).toBe(scenario.expected === 3)
                if (scenario.expected === 0 || scenario.expected === 3) {
                    const evidence = await (scenario.expected === 0 ? approved : blocked).json()
                    expect(evidence).toMatchObject({
                        revision,
                        digest,
                        scope: 'rentnerproxy-locked-cargo-and-bun',
                        externalRuntimePolicy: 'informational',
                        verdict: scenario.expected === 0 ? 'own-dependencies-approved' : 'blocked',
                    })
                }
                if (scenario.expected === 0) {
                    expect(await readFile(join(directory, 'outputs'), 'utf8')).toBe(
                        `digest=${digest}\n`,
                    )
                    expect(await readFile(join(directory, 'summary.md'), 'utf8')).toContain(
                        'not a full-image security approval',
                    )
                } else expect(await Bun.file(join(directory, 'outputs')).exists()).toBe(false)
            } finally {
                await rm(directory, { recursive: true, force: true })
            }
        })
    }
})
