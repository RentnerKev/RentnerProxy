import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'bun:test'

const root = resolve(import.meta.dir, '../../../../..')
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash'
const revision = 'a'.repeat(40)
const digest = 'sha256:' + createHash('sha256').update('fixture-manifest').digest('hex')

function shellPath(path: string): string {
    const normalized = path.replaceAll('\\', '/')
    return process.platform === 'win32'
        ? normalized.replace(/^([a-z]):\//iu, (_match, drive: string) => `/${drive.toLowerCase()}/`)
        : normalized
}

describe('preview publication assessment guard', () => {
    test('rejects missing, blocked, stale and mismatched assessments before registry access', async () => {
        const parent = join(root, 'tmp')
        await mkdir(parent, { recursive: true })
        const directory = await mkdtemp(join(parent, 'preview-guard-'))
        const bin = join(directory, 'bin')
        await mkdir(bin)
        const marker = join(directory, 'calls')
        const report = join(directory, 'assessment.json')
        const policySource = await readFile(
            join(root, '.github/scripts/security/dependency-policy.ts'),
            'utf8',
        )
        const policy = /const policy = '([^']+)'/u.exec(policySource)?.[1]
        expect(policy).toBeDefined()
        const approved = {
            revision,
            digest,
            policy,
            verdict: 'own-dependencies-approved',
            scope: 'rentnerproxy-locked-cargo-and-bun',
            externalRuntimePolicy: 'informational',
            assessedAt: new Date().toISOString(),
        }
        await Promise.all([
            writeFile(
                join(bin, 'skopeo'),
                '#!/bin/bash\nif [[ "$*" == *"--raw"* ]]; then printf fixture-manifest; else echo registry >> "$MARKER"; exit 88; fi\n',
                { mode: 0o755 },
            ),
            writeFile(
                join(bin, 'jq'),
                '#!/bin/bash\nprintf \'{"revision":"%s","digest":"%s"}\\n\' "$4" "$7"\n',
                { mode: 0o755 },
            ),
            writeFile(
                join(bin, 'bun'),
                '#!/bin/bash\nif [[ "$1" == --no-env-file && "$2" == *dependency-policy.ts ]]; then shift 2; exec "$REAL_BUN" --no-env-file "$REAL_POLICY" "$@"; fi\necho revalidate >> "$MARKER"\nexit 77\n',
                { mode: 0o755 },
            ),
        ])
        async function run(value: unknown, sourceDigest = digest) {
            await rm(marker, { force: true })
            await rm(report, { force: true })
            if (value !== undefined) await writeFile(report, JSON.stringify(value))
            const child = Bun.spawn(
                [
                    bash,
                    '--noprofile',
                    '--norc',
                    '-c',
                    'export PATH="$TOOL_DIRECTORY:/usr/bin:/bin"; chmod +x "$TOOL_DIRECTORY"/*; exec bash "$PUBLISH_SCRIPT"',
                ],
                {
                    cwd: directory,
                    env: {
                        PATH: '/usr/bin:/bin',
                        TOOL_DIRECTORY: shellPath(bin),
                        PUBLISH_SCRIPT: shellPath(
                            join(root, '.github/scripts/deploy/publish-preview-image.sh'),
                        ),
                        RUNNER_TEMP: '.',
                        ARTIFACT_DIRECTORY: '.',
                        ASSESSED_REPORT: shellPath(report),
                        SOURCE_IMAGE_DIGEST: sourceDigest,
                        TESTED_SHA: revision,
                        REAL_BUN: shellPath(process.execPath),
                        REAL_POLICY: shellPath(
                            join(root, '.github/scripts/security/dependency-policy.ts'),
                        ),
                        MARKER: shellPath(marker),
                    },
                    stdin: 'ignore',
                    stdout: 'ignore',
                    stderr: 'ignore',
                },
            )
            const exit = await child.exited
            const calls = (await Bun.file(marker).exists()) ? await readFile(marker, 'utf8') : ''
            return { exit, calls }
        }
        try {
            for (const value of [
                undefined,
                { ...approved, verdict: 'blocked' },
                { ...approved, verdict: 'approved' },
                { ...approved, verdict: 'dev-risk-accepted' },
                { ...approved, scope: undefined },
                { ...approved, externalRuntimePolicy: undefined },
                { ...approved, assessedAt: '2000-01-01T00:00:00Z' },
                { ...approved, revision: 'b'.repeat(40) },
                { ...approved, digest: 'sha256:' + 'b'.repeat(64) },
            ]) {
                // oxlint-disable-next-line no-await-in-loop -- One owned shell fixture is reused in order.
                const result = await run(value)
                expect(result.exit).not.toBe(0)
                expect(result.calls).toBe('')
            }
            expect((await run(approved, 'sha256:' + 'c'.repeat(64))).calls).toBe('')
            expect(await run(approved)).toEqual({ exit: 77, calls: 'revalidate\n' })
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })
})
