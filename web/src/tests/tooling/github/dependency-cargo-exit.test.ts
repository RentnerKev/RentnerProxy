import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '../../../../..')
const gitBash = 'C:/Program Files/Git/bin/bash.exe'
const bash = process.platform === 'win32' && existsSync(gitBash) ? gitBash : Bun.which('bash')
const revision = 'a'.repeat(40)
const temporaryPrefix = 'rentnerproxy-cargo-exit-'

function shellPath(path: string): string {
    const normalized = path.replaceAll('\\', '/')
    return process.platform === 'win32'
        ? normalized.replace(/^([a-z]):\//iu, (_match, drive: string) => `/${drive.toLowerCase()}/`)
        : normalized
}

const cleanReport = {
    database: {
        'last-commit': revision,
        'last-updated': new Date().toISOString(),
        'advisory-count': 1,
    },
    lockfile: { 'dependency-count': 1 },
    settings: { ignore: [], severity: null, target_arch: [], target_os: [] },
    warnings: {},
    vulnerabilities: { count: 0, list: [] },
}
const blockedReport = {
    ...cleanReport,
    vulnerabilities: {
        count: 1,
        list: [{ advisory: { id: 'RUSTSEC-synthetic-fixture' } }],
    },
}

const cases = [
    { name: 'foreign scanner exit 3 with empty evidence', scannerExit: 3, report: '', expected: 1 },
    {
        name: 'foreign scanner exit 3 with invalid evidence',
        scannerExit: 3,
        report: '{',
        expected: 1,
    },
    {
        name: 'foreign scanner exit 3 with valid adverse evidence',
        scannerExit: 3,
        report: JSON.stringify(blockedReport),
        expected: 1,
    },
    { name: 'scanner exit 1 with malformed evidence', scannerExit: 1, report: '{', expected: 1 },
    {
        name: 'scanner exit 1 with valid adverse evidence',
        scannerExit: 1,
        report: JSON.stringify(blockedReport),
        expected: 3,
    },
    {
        name: 'scanner exit 0 with valid clean evidence',
        scannerExit: 0,
        report: JSON.stringify(cleanReport),
        expected: 0,
    },
    {
        name: 'early foreign Git tool exit 3',
        scannerExit: 0,
        report: JSON.stringify(cleanReport),
        expected: 1,
        gitExit: 3,
    },
] as const

// Exercise the real wrapper and policy CLI without invoking Cargo, Git network
// operations, or an installed jq. Bash's basic file utilities stay local.
describe('Cargo assessment exit contract with synthetic tools', () => {
    for (const scenario of cases) {
        test.skipIf(!bash)(scenario.name, async () => {
            if (!bash) throw new Error('Bash is unavailable; this test requires Bash in CI.')
            const temporaryRoot = resolve(tmpdir())
            const directory = await mkdtemp(join(temporaryRoot, temporaryPrefix))
            // This immutable cleanup target must be the directory we just created.
            if (
                dirname(resolve(directory)) !== temporaryRoot ||
                !basename(directory).startsWith(temporaryPrefix)
            ) {
                throw new Error('Refusing cleanup outside the owned test directory.')
            }
            try {
                const tools = join(directory, 'tools')
                const scannerDirectory = join(directory, 'cargo-audit', 'bin')
                const source = join(directory, 'source')
                const report = join(directory, 'scanner.json')
                const log = join(directory, 'tools.log')
                await Promise.all([
                    mkdir(tools, { recursive: true }),
                    mkdir(scannerDirectory, { recursive: true }),
                    mkdir(join(source, 'core'), { recursive: true }),
                ])
                await Promise.all([
                    writeFile(
                        join(source, 'core', 'Cargo.lock'),
                        '# synthetic unit-test lock data\n',
                    ),
                    writeFile(report, scenario.report),
                    writeFile(
                        join(tools, 'git'),
                        `#!/usr/bin/env bash
set -Eeuo pipefail
printf 'git:%s\\n' "$1" >> "$TOOL_LOG"
if [[ "$1" == clone ]]; then
    if (( GIT_EXIT != 0 )); then exit "$GIT_EXIT"; fi
    mkdir -p "\${!#}"
elif [[ "$1" == -C && "$3" == rev-parse && "$4" == HEAD ]]; then
    printf '%s\\n' "$REVISION"
else
    exit 91
fi
`,
                        { mode: 0o755 },
                    ),
                    writeFile(
                        join(tools, 'cargo'),
                        `#!/usr/bin/env bash
printf 'unexpected-cargo-install\\n' >> "$TOOL_LOG"
exit 91
`,
                        { mode: 0o755 },
                    ),
                    writeFile(
                        join(tools, 'bun'),
                        `#!/usr/bin/env bash
exec "$BUN_EXECUTABLE" "$@"
`,
                        { mode: 0o755 },
                    ),
                    writeFile(
                        join(tools, 'jq'),
                        `#!/usr/bin/env bash
exec "$BUN_EXECUTABLE" --no-env-file "$JQ_FIXTURE" "$@"
`,
                        { mode: 0o755 },
                    ),
                    writeFile(
                        join(directory, 'jq-fixture.ts'),
                        `
const args = process.argv.slice(2)
const revisionIndex = args.indexOf('revision')
const timestampIndex = args.indexOf('fetchedAt')
const revision = args[revisionIndex + 1]
const fetchedAt = args[timestampIndex + 1]
if (args[0] !== '--null-input' || revisionIndex < 0 || timestampIndex < 0 ||
    !revision || !fetchedAt || !/^[a-f0-9]{40}$/.test(revision) ||
    !Number.isFinite(Date.parse(fetchedAt))) throw new Error('Unexpected jq fixture arguments')
console.log(JSON.stringify({ revision, fetchedAt }))
`,
                    ),
                    writeFile(
                        join(scannerDirectory, 'cargo-audit'),
                        `#!/usr/bin/env bash
set -Eeuo pipefail
printf 'scanner:%s\\n' "$SCANNER_EXIT" >> "$TOOL_LOG"
cat "$SCANNER_REPORT"
exit "$SCANNER_EXIT"
`,
                        { mode: 0o755 },
                    ),
                ])
                const child = Bun.spawn(
                    [
                        bash,
                        '--noprofile',
                        '--norc',
                        '-c',
                        'export PATH="$TOOL_DIRECTORY:/usr/bin:/bin"; chmod +x "$TOOL_DIRECTORY"/* "$RUNNER_TEMP/cargo-audit/bin/cargo-audit"; exec bash "$AUDIT_SCRIPT"',
                    ],
                    {
                        cwd: directory,
                        env: {
                            PATH: '/usr/bin:/bin',
                            AUTOMATION_DIRECTORY: shellPath(root),
                            AUDIT_SCRIPT: shellPath(
                                join(root, '.github/scripts/security/audit-cargo.sh'),
                            ),
                            BUN_EXECUTABLE: shellPath(process.execPath),
                            GIT_EXIT: String('gitExit' in scenario ? scenario.gitExit : 0),
                            JQ_FIXTURE: './jq-fixture.ts',
                            REPORT_DIRECTORY: './report',
                            REVISION: revision,
                            RUNNER_TEMP: '.',
                            SCANNER_EXIT: String(scenario.scannerExit),
                            SCANNER_REPORT: './scanner.json',
                            SOURCE_DIRECTORY: './source',
                            TOOL_DIRECTORY: './tools',
                            TOOL_LOG: './tools.log',
                        },
                        stdout: 'pipe',
                        stderr: 'pipe',
                    },
                )
                const [stdout, stderr, exitCode] = await Promise.all([
                    new Response(child.stdout).text(),
                    new Response(child.stderr).text(),
                    child.exited,
                ])
                expect(exitCode, `${stdout}\n${stderr}`).toBe(scenario.expected)
                const calls = await readFile(log, 'utf8')
                expect(calls).toContain('git:clone')
                expect(calls).not.toContain('unexpected-cargo-install')
                if ('gitExit' in scenario) expect(calls).not.toContain('scanner:')
                else expect(calls).toContain(`scanner:${scenario.scannerExit}`)
            } finally {
                // Delete only the single mkdtemp directory created by this test.
                await rm(directory, { recursive: true, force: true })
            }
        })
    }
})
