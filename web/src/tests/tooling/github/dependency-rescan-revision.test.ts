import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '../../../../..')
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash'
const revision = 'a'.repeat(40)
const validConfig = JSON.stringify({
    config: { Labels: { 'org.opencontainers.image.revision': revision } },
})
const digest = 'sha256:' + createHash('sha256').update('fixture-manifest').digest('hex')
const prefix = 'rentnerproxy-rescan-revision-'

function shellPath(path: string): string {
    const normalized = path.replaceAll('\\', '/')
    return process.platform === 'win32'
        ? normalized.replace(/^([a-z]):\//iu, (_match, drive: string) => `/${drive.toLowerCase()}/`)
        : normalized
}

describe('deployed image revision validation', () => {
    for (const scenario of [
        {
            name: 'valid immutable metadata',
            config: validConfig,
            configExit: 0,
            expected: 0,
            scans: 1,
        },
        {
            name: 'complete adverse assessment',
            config: validConfig,
            configExit: 0,
            scanExit: 3,
            expected: 3,
            scans: 1,
        },
        ...[
            'missing',
            'malformed',
            'wrong-revision',
            'wrong-digest',
            'wrong-verdict',
            'wrong-scope',
            'stale',
        ].map((evidence) => ({
            name: `${evidence} adverse evidence`,
            config: validConfig,
            configExit: 0,
            scanExit: 3,
            evidence,
            expected: 1,
            scans: 1,
        })),
        ...[
            'missing',
            'malformed',
            'wrong-revision',
            'wrong-digest',
            'wrong-verdict',
            'wrong-scope',
            'stale',
        ].map((evidence) => ({
            name: `${evidence} approval evidence`,
            config: validConfig,
            configExit: 0,
            scanExit: 0,
            evidence,
            expected: 1,
            scans: 1,
        })),
        {
            name: 'scanner failure',
            config: validConfig,
            configExit: 0,
            scanExit: 1,
            expected: 1,
            scans: 1,
        },
        {
            name: 'failed dev resolution',
            config: validConfig,
            configExit: 0,
            rawExit: 1,
            expected: 1,
            scans: 0,
        },
        { name: 'missing revision label', config: '{}', configExit: 0, expected: 1, scans: 0 },
        {
            name: 'invalid revision label',
            config: JSON.stringify({
                config: { Labels: { 'org.opencontainers.image.revision': 'invalid' } },
            }),
            configExit: 0,
            expected: 1,
            scans: 0,
        },
        { name: 'malformed config JSON', config: '{', configExit: 0, expected: 1, scans: 0 },
        {
            name: 'failed immutable config fetch',
            config: validConfig,
            configExit: 3,
            expected: 1,
            scans: 0,
        },
    ]) {
        test(`real wrapper handles ${scenario.name} for the current dev digest`, async () => {
            const directory = await mkdtemp(join(tmpdir(), prefix))
            if (dirname(directory) !== resolve(tmpdir()) || !basename(directory).startsWith(prefix))
                throw new Error('Unexpected rescan fixture directory')
            const bin = join(directory, 'bin')
            const automation = join(directory, 'automation')
            const scriptDirectory = join(automation, '.github/scripts/security')
            await Promise.all([mkdir(bin), mkdir(scriptDirectory, { recursive: true })])
            const calls = join(directory, 'scans')
            await Promise.all([
                writeFile(calls, ''),
                writeFile(
                    join(bin, 'jq'),
                    '#!/bin/bash\nexec "$REAL_BUN" --no-env-file jq-fixture.ts "$@"\n',
                    { mode: 0o755 },
                ),
                writeFile(
                    join(bin, 'bun'),
                    '#!/bin/bash\nshift 2\nexec "$REAL_BUN" --no-env-file "$REAL_POLICY" "$@"\n',
                    { mode: 0o755 },
                ),
                writeFile(
                    join(directory, 'jq-fixture.ts'),
                    `const args = process.argv.slice(2)
if (args.includes('--null-input')) {
    const revision = args[args.indexOf('revision') + 1]
    const digest = args[args.indexOf('digest') + 1]
    console.log(JSON.stringify({ revision, digest }))
    process.exit(0)
}
const input = JSON.parse(await Bun.stdin.text())
const label = input.config?.Labels?.['org.opencontainers.image.revision']
if (label != null) console.log(label)
`,
                ),
                writeFile(
                    join(bin, 'skopeo'),
                    '#!/bin/bash\nprintf "%s\\n" "$*" >> "$INSPECTIONS"\nif [[ "$*" == *--raw* ]]; then printf fixture-manifest; exit "$RAW_EXIT"; fi\nprintf "%s" "$CONFIG_JSON"; exit "$CONFIG_EXIT"\n',
                    { mode: 0o755 },
                ),
                writeFile(
                    join(scriptDirectory, 'scan-image.sh'),
                    `#!/bin/bash
printf '%s\\n' "$REVISION" >> "$SCANS"
result="$SCAN_EXIT"
evidence="$EVIDENCE"
if (( result == 0 || result == 3 )); then
    path="$REPORT_DIRECTORY/assessment.json"
    verdict=own-dependencies-approved
    if (( result == 3 )); then path="$REPORT_DIRECTORY/blocked-assessment.json"; verdict=blocked; fi
    source_revision="$REVISION"
    digest="\${IMAGE_SOURCE##*@}"
    scope=rentnerproxy-locked-cargo-and-bun
    assessed_at="$ASSESSED_AT"
    case "$evidence" in
        missing) exit "$result" ;;
        malformed) printf '{' > "$path"; exit "$result" ;;
        wrong-revision) source_revision=wrong ;;
        wrong-digest) digest=wrong ;;
        wrong-verdict) verdict=approved ;;
        wrong-scope) scope=full-image ;;
        stale) assessed_at=2000-01-01T00:00:00Z ;;
    esac
    printf '{"verdict":"%s","revision":"%s","digest":"%s","scope":"%s","policy":"moderate-and-above Bun; all RustSec findings","externalRuntimePolicy":"informational","assessedAt":"%s"}' "$verdict" "$source_revision" "$digest" "$scope" "$assessed_at" > "$path"
fi
exit "$result"
`,
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
                        'export PATH="$TOOL_DIRECTORY:/usr/bin:/bin"; chmod +x "$TOOL_DIRECTORY"/*; exec bash "$RESCAN_SCRIPT"',
                    ],
                    {
                        cwd: directory,
                        env: {
                            PATH: '/usr/bin:/bin',
                            TOOL_DIRECTORY: shellPath(bin),
                            RESCAN_SCRIPT: shellPath(
                                join(root, '.github/scripts/security/rescan-dev-image.sh'),
                            ),
                            GITHUB_REPOSITORY: 'Example/Fixture',
                            AUTOMATION_DIRECTORY: 'automation',
                            REPORT_DIRECTORY: 'reports',
                            CONFIG_JSON: scenario.config,
                            CONFIG_EXIT: String(scenario.configExit),
                            RAW_EXIT: String('rawExit' in scenario ? scenario.rawExit : 0),
                            INSPECTIONS: 'inspections',
                            SCANS: 'scans',
                            SCAN_EXIT: String('scanExit' in scenario ? scenario.scanExit : 0),
                            EVIDENCE: 'evidence' in scenario ? scenario.evidence : 'valid',
                            GITHUB_STEP_SUMMARY: 'job-summary.md',
                            REAL_BUN: shellPath(process.execPath),
                            REAL_POLICY: shellPath(
                                join(root, '.github/scripts/security/dependency-policy.ts'),
                            ),
                            ASSESSED_AT: new Date().toISOString(),
                        },
                        stdin: 'ignore',
                        stdout: 'pipe',
                        stderr: 'pipe',
                    },
                )
                const [_stdout, stderr] = await Promise.all([
                    new Response(child.stdout).text(),
                    new Response(child.stderr).text(),
                ])
                expect(await child.exited, stderr).toBe(scenario.expected)
                expect((await readFile(calls, 'utf8')).trim().split('\n').filter(Boolean)).toEqual(
                    Array.from({ length: scenario.scans }, () => revision),
                )
                const summary = await readFile(join(directory, 'reports/rescan-summary.md'), 'utf8')
                expect(await readFile(join(directory, 'job-summary.md'), 'utf8')).toBe(summary)
                const inspections = (await readFile(join(directory, 'inspections'), 'utf8'))
                    .trim()
                    .split('\n')
                expect(inspections[0]).toBe('inspect --raw docker://ghcr.io/example/fixture:dev')
                if (!('rawExit' in scenario))
                    expect(inspections[1]).toBe(
                        `inspect --override-os linux --override-arch amd64 --config docker://ghcr.io/example/fixture@${digest}`,
                    )
                if (scenario.expected === 0) {
                    expect(summary).toContain('The current dev own-dependency gate passed')
                } else if (scenario.expected === 3) {
                    expect(summary).toContain('| `dev` | Blocked: own dependency advisories |')
                    expect(summary).toContain(
                        'Assessment complete: the dev image is blocked by own Cargo/Bun dependency advisories',
                    )
                } else {
                    expect(summary).toContain('Assessment incomplete or invalid')
                    expect(summary).not.toContain('The current dev own-dependency gate passed')
                }
            } finally {
                await rm(directory, { recursive: true, force: true })
            }
        })
    }
})
