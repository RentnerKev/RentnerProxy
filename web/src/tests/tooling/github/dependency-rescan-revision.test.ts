import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '../../../../..')
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash'
const revision = 'a'.repeat(40)
const validConfig = JSON.stringify({
    config: { Labels: { 'org.opencontainers.image.revision': revision } },
})
const prefix = 'rentnerproxy-rescan-revision-'

describe('deployed image revision validation', () => {
    for (const scenario of [
        {
            name: 'valid immutable metadata',
            config: validConfig,
            configExit: 0,
            expected: 0,
            scans: 2,
        },
        { name: 'missing revision label', config: '{}', configExit: 0, expected: 1, scans: 1 },
        {
            name: 'invalid revision label',
            config: JSON.stringify({
                config: { Labels: { 'org.opencontainers.image.revision': 'invalid' } },
            }),
            configExit: 0,
            expected: 1,
            scans: 1,
        },
        { name: 'malformed config JSON', config: '{', configExit: 0, expected: 1, scans: 1 },
        {
            name: 'failed immutable config fetch',
            config: validConfig,
            configExit: 3,
            expected: 1,
            scans: 1,
        },
    ]) {
        test(`real wrapper handles ${scenario.name} before scanning and still assesses the next tag`, async () => {
            const directory = await mkdtemp(join(tmpdir(), prefix))
            if (dirname(directory) !== resolve(tmpdir()) || !basename(directory).startsWith(prefix))
                throw new Error('Unexpected rescan fixture directory')
            const bin = join(directory, 'bin')
            const automation = join(directory, 'automation')
            const scriptDirectory = join(automation, '.github/scripts/security')
            await Promise.all([mkdir(bin), mkdir(scriptDirectory, { recursive: true })])
            const tags = join(directory, 'tags')
            const calls = join(directory, 'scans')
            await Promise.all([
                writeFile(tags, 'first\nsecond\n'),
                writeFile(
                    join(bin, 'jq'),
                    '#!/bin/bash\nexec "$REAL_BUN" --no-env-file jq-fixture.ts\n',
                    { mode: 0o755 },
                ),
                writeFile(
                    join(directory, 'jq-fixture.ts'),
                    'const input = JSON.parse(await Bun.stdin.text()); const label = input.config?.Labels?.["org.opencontainers.image.revision"]; if (label != null) console.log(label);\n',
                ),
                writeFile(
                    join(bin, 'skopeo'),
                    '#!/bin/bash\nif [[ "$*" == *--raw* ]]; then printf fixture-manifest; exit 0; fi\nif [[ ! -f "$CONFIG_COUNT" ]]; then touch "$CONFIG_COUNT"; printf "%s" "$CONFIG_JSON"; exit "$CONFIG_EXIT"; fi\nprintf "%s" "$VALID_CONFIG"\n',
                    { mode: 0o755 },
                ),
                writeFile(
                    join(scriptDirectory, 'scan-image.sh'),
                    '#!/bin/bash\nprintf "%s\\n" "$REVISION" >> "$SCANS"\n',
                    { mode: 0o755 },
                ),
            ])
            try {
                const child = Bun.spawn(
                    [
                        bash,
                        '--noprofile',
                        '--norc',
                        join(root, '.github/scripts/security/rescan-supported-images.sh'),
                    ],
                    {
                        cwd: directory,
                        env: {
                            ...process.env,
                            PATH:
                                bin + (process.platform === 'win32' ? ';' : ':') + process.env.PATH,
                            GITHUB_REPOSITORY: 'Example/Fixture',
                            AUTOMATION_DIRECTORY: 'automation',
                            SUPPORTED_TAGS_FILE: 'tags',
                            REPORT_DIRECTORY: 'reports',
                            CONFIG_COUNT: 'configs',
                            CONFIG_JSON: scenario.config,
                            CONFIG_EXIT: String(scenario.configExit),
                            VALID_CONFIG: validConfig,
                            SCANS: 'scans',
                            REAL_BUN: process.execPath,
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
                expect((await readFile(calls, 'utf8')).trim().split('\n')).toEqual(
                    Array.from({ length: scenario.scans }, () => revision),
                )
            } finally {
                await rm(directory, { recursive: true, force: true })
            }
        })
    }
})
