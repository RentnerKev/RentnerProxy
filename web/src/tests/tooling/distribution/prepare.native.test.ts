// oxlint-disable no-await-in-loop -- Reuse a neutral fixture path to check each binary key export in turn.
import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import {
    prepareDistribution,
    distributionWorkflowIdentity,
} from '../../../../../.github/scripts/distribution/prepare.ts'
import {
    distributionBytes,
    distributionCommand,
} from '../../../../../.github/scripts/distribution/process.ts'
import { runMaintenanceProcess } from '../../../../../scripts/backup/maintenance-process.ts'
import {
    verifyDistributionBundle,
    distributionFileHash,
} from '../../../../../.github/scripts/distribution/bundle.ts'
import { assembleMultiarchImage } from '../../../../../.github/scripts/release/multiarch-image.ts'
import { hashOciFile } from '../../../../../.github/scripts/lib/oci-layout.ts'
import { identity, platformFixture, workflow, hash } from '../github/fixtures/oci.ts'

const enabled = process.platform === 'linux' && process.env.RENTNERPROXY_PACKAGE_TEST === '1'
const source = fileURLToPath(new URL('../../../../../', import.meta.url))

async function containsSecretPackets(home: string, path: string) {
    const result = await runMaintenanceProcess(
        ['gpg', '--homedir', home, '--batch', '--list-packets', path],
        { cwd: home, timeoutMs: 10_000, maximumOutputBytes: 4 * 1024 * 1024 },
    )
    expect(result.stopped).toBe(true)
    return /:secret (?:sub )?key packet:/u.test(Buffer.from(result.stdout).toString('utf8'))
}

test.skipIf(!enabled)(
    'bundle secret-packet scanner detects binary primary and subkey exports under neutral names',
    async () => {
        const directory = await mkdtemp(join(tmpdir(), 'rp-secret-scanner-'))
        try {
            const home = join(directory, 'home'),
                path = join(directory, 'neutral.bin')
            await mkdir(home, { mode: 0o700 })
            await distributionCommand([
                'gpg',
                '--homedir',
                home,
                '--batch',
                '--passphrase',
                '',
                '--quick-generate-key',
                'Scanner fixture <scanner@example.invalid>',
                'ed25519',
                'sign',
                '1d',
            ])
            const fingerprint = (
                await distributionCommand([
                    'gpg',
                    '--homedir',
                    home,
                    '--with-colons',
                    '--list-keys',
                ])
            )
                .split('\n')
                .find((line) => line.startsWith('fpr:'))!
                .split(':')[9]!
            await distributionCommand([
                'gpg',
                '--homedir',
                home,
                '--batch',
                '--passphrase',
                '',
                '--quick-add-key',
                fingerprint,
                'cv25519',
                'encr',
                '1d',
            ])
            for (const operation of [
                '--export-secret-keys',
                '--export-secret-subkeys',
                '--export',
            ]) {
                await writeFile(
                    path,
                    await distributionBytes([
                        'gpg',
                        '--homedir',
                        home,
                        '--batch',
                        operation,
                        fingerprint,
                    ]),
                )
                expect(await containsSecretPackets(home, path)).toBe(operation !== '--export')
            }
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    },
)

test('distribution build inputs reject unbound source, versions and workflow attempts', () => {
    const env = {
        REVISION: identity.revision,
        VERSION: identity.version,
        EXPECTED_DIGEST: hash('fixture'),
        GITHUB_RUN_ID: workflow.runId,
        GITHUB_RUN_ATTEMPT: String(workflow.runAttempt),
    }
    expect(distributionWorkflowIdentity(env)).toEqual({
        ...identity,
        ...workflow,
        digest: env.EXPECTED_DIGEST,
    })
    for (const change of [
        { REVISION: 'main' },
        { VERSION: 'development' },
        { GITHUB_RUN_ID: '0' },
        { GITHUB_RUN_ATTEMPT: '0' },
        { GITHUB_RUN_ATTEMPT: '1.5' },
    ])
        expect(() => distributionWorkflowIdentity({ ...env, ...change })).toThrow()
})

test.skipIf(!enabled)(
    'artifact production verifies real OCI transport and produces complete signed fixture repositories without private key artifacts',
    async () => {
        const directory = await mkdtemp(join(tmpdir(), 'rp-distribution-prepare-'))
        try {
            const amd = await platformFixture(join(directory, 'amd64'), 'amd64'),
                arm = await platformFixture(join(directory, 'arm64'), 'arm64')
            const portability = JSON.stringify({
                schemaVersion: 1,
                ...identity,
                sourceManifest: amd.runtime.digest,
                targetManifest: arm.runtime.digest,
                backupVersion: 4,
                checks: 'amd64-backup-to-native-arm64',
                nativeUpgradeSources: [],
            })
            await writeFile(join(directory, 'portability.json'), portability)
            const combined = join(directory, 'combined'),
                candidate = join(directory, 'candidate'),
                output = join(directory, 'output')
            await mkdir(candidate)
            const evidence = await assembleMultiarchImage({
                directory,
                output: combined,
                identity,
                ...workflow,
                expected: { amd64: amd.expected, arm64: arm.expected },
                portabilitySha256: hash(portability).slice(7),
            })
            const archive = join(candidate, 'candidate-image.tar'),
                proof = join(candidate, 'evidence.json')
            await distributionCommand([
                'skopeo',
                'copy',
                '--all',
                '--preserve-digests',
                'oci:' + combined + ':candidate',
                'oci-archive:' + archive + ':candidate',
            ])
            await writeFile(proof, JSON.stringify(evidence))
            const env = {
                REVISION: identity.revision,
                VERSION: identity.version,
                EXPECTED_DIGEST: evidence.digest,
                GITHUB_RUN_ID: workflow.runId,
                GITHUB_RUN_ATTEMPT: String(workflow.runAttempt),
                SOURCE_DIRECTORY: source,
                CANDIDATE_DIRECTORY: candidate,
                DISTRIBUTION_DIRECTORY: output,
                GITHUB_OUTPUT: join(directory, 'outputs'),
                ARCHIVE_SHA256: (await hashOciFile(archive)).slice(7),
                EVIDENCE_SHA256: (await hashOciFile(proof)).slice(7),
            }
            await prepareDistribution(env)
            const checksum = (await readFile(env.GITHUB_OUTPUT, 'utf8')).trim().split('=')[1]!
            expect(checksum).toBe(await distributionFileHash(join(output, 'bundle.json')))
            await verifyDistributionBundle(output, checksum, {
                ...identity,
                ...workflow,
                digest: evidence.digest,
            })
            const bundle = JSON.parse(await readFile(join(output, 'bundle.json'), 'utf8'))
            expect(
                bundle.files.some((file: { file: string }) => file.file.endsWith('InRelease')),
            ).toBe(true)
            expect(
                bundle.files.some((file: { file: string }) =>
                    /private|secret|fixture-key|gnupg/iu.test(file.file),
                ),
            ).toBe(false)
            const scanHome = join(directory, 'packet-scan')
            await mkdir(scanHome, { mode: 0o700 })
            expect(
                await Promise.all(
                    bundle.files.map((file: { file: string }) =>
                        containsSecretPackets(scanHome, join(output, file.file)),
                    ),
                ),
            ).not.toContain(true)
            expect(await Bun.file(join(output, 'native-probe.js')).exists()).toBe(true)
            await expect(
                prepareDistribution({ ...env, ARCHIVE_SHA256: 'c'.repeat(64) }),
            ).rejects.toThrow('checksum')
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    },
    120_000,
)
