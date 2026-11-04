// oxlint-disable no-await-in-loop -- Verify successive report corruptions against the same immutable candidate.
import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { hash, identity, platformFixture, workflow } from './fixtures/oci.ts'

const script = resolve(import.meta.dir, '../../../../../.github/scripts/release/multiarch-image.ts')

async function command(mode: string, env: NodeJS.ProcessEnv) {
    const child = Bun.spawn([process.execPath, '--no-env-file', script, mode], {
        env,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: 5000,
    })
    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ])
    return { stdout, stderr, exitCode }
}

describe('assessed multiarch CLI publication boundary', () => {
    test('seals the exact producer outputs and independently requires fresh approvals for both published platforms', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'rp-oci-cli-'))
        try {
            const amd64 = await platformFixture(join(directory, 'amd64'), 'amd64')
            const arm64 = await platformFixture(join(directory, 'arm64'), 'arm64')
            const portability = JSON.stringify({
                schemaVersion: 1,
                ...identity,
                sourceManifest: amd64.runtime.digest,
                targetManifest: arm64.runtime.digest,
                backupVersion: 4,
                checks: 'amd64-backup-to-native-arm64',
                nativeUpgradeSources: [],
            })
            await writeFile(join(directory, 'portability.json'), portability)
            const env: NodeJS.ProcessEnv = {
                ...process.env,
                REVISION: identity.revision,
                VERSION: identity.version,
                GITHUB_RUN_ID: workflow.runId,
                GITHUB_RUN_ATTEMPT: String(workflow.runAttempt),
                IMAGE_DIRECTORY: directory,
                IMAGE_OUTPUT: join(directory, 'combined'),
                GITHUB_OUTPUT: join(directory, 'output'),
                PORTABILITY_SHA256: hash(portability).slice(7),
                AMD64_DIGEST: amd64.expected.digest,
                AMD64_ARCHIVE_SHA256: amd64.expected.archiveSha256,
                AMD64_EVIDENCE_SHA256: amd64.expected.evidenceSha256,
                ARM64_DIGEST: arm64.expected.digest,
                ARM64_ARCHIVE_SHA256: arm64.expected.archiveSha256,
                ARM64_EVIDENCE_SHA256: arm64.expected.evidenceSha256,
            }
            expect((await command('assemble', env)).exitCode).toBe(0)
            const evidenceText = await readFile(join(directory, 'evidence.json'), 'utf8')
            const evidence = JSON.parse(evidenceText) as { digest: string }
            expect(await readFile(env.GITHUB_OUTPUT!, 'utf8')).toBe(
                `digest=${evidence.digest}\nplatforms=linux/amd64,linux/arm64\nevidence_sha256=${hash(evidenceText).slice(7)}\n`,
            )
            const reports = join(directory, 'reports')
            const approval = {
                revision: identity.revision,
                digest: evidence.digest,
                verdict: 'own-dependencies-approved',
                scope: 'rentnerproxy-locked-cargo-and-bun',
                policy: 'moderate-and-above Bun; all RustSec findings',
                externalRuntimePolicy: 'informational',
                assessedAt: new Date().toISOString(),
            }
            for (const architecture of ['amd64', 'arm64']) {
                await mkdir(join(reports, architecture), { recursive: true })
                await writeFile(
                    join(reports, architecture, 'assessment.json'),
                    JSON.stringify(approval),
                )
            }
            const verify = {
                ...env,
                IMAGE_DIRECTORY: env.IMAGE_OUTPUT,
                EVIDENCE_FILE: join(directory, 'evidence.json'),
                EXPECTED_DIGEST: evidence.digest,
                PLATFORM_REPORT_DIRECTORY: reports,
            }
            expect((await command('verify', verify)).exitCode).toBe(0)
            for (const corrupt of [
                { verdict: 'blocked' },
                { digest: hash('foreign') },
                { revision: 'b'.repeat(40) },
                { assessedAt: '2000-01-01T00:00:00Z' },
            ]) {
                await writeFile(
                    join(reports, 'arm64/assessment.json'),
                    JSON.stringify({ ...approval, ...corrupt }),
                )
                const result = await command('verify', verify)
                expect(result.exitCode).toBe(1)
                expect(result.stderr.trim()).toBe(
                    'Assessed multi-architecture image validation failed.',
                )
            }
            await rm(join(reports, 'arm64/assessment.json'))
            expect((await command('verify', verify)).exitCode).toBe(1)
            expect(
                (await command('verify', { ...verify, PLATFORM_REPORT_DIRECTORY: '' })).exitCode,
            ).toBe(1)
            expect(
                (await command('verify', { ...verify, GITHUB_RUN_ATTEMPT: 'invalid' })).exitCode,
            ).toBe(1)
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })
})
