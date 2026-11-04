// oxlint-disable no-await-in-loop -- Exercise immutable signing, retries and tamper rejection against real GPG/RPM tools.
import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { buildDistributionPackages } from '../../../../../.github/scripts/distribution/packages.ts'
import { parseDistributionRelease } from '../../../../../.github/scripts/distribution/release.ts'
import {
    distributionBytes,
    distributionCommand,
} from '../../../../../.github/scripts/distribution/process.ts'
import {
    bundleFiles,
    distributionFileHash,
    writeDistributionBundle,
} from '../../../../../.github/scripts/distribution/bundle.ts'
import {
    signDistribution,
    validateRepositoryTree,
    verifyRepositoryHistory,
} from '../../../../../.github/scripts/distribution/publication.ts'
import { identity, platformFixture, workflow } from '../github/fixtures/oci.ts'

const enabled = process.platform === 'linux' && process.env.RENTNERPROXY_PACKAGE_TEST === '1'
const source = fileURLToPath(new URL('../../../../../', import.meta.url))

test.skipIf(!enabled)(
    'the trusted signer binds all native gates, signs provenance/SBOM and preserves byte-identical release retries',
    async () => {
        const directory = await mkdtemp(join(tmpdir(), 'rp-publication-native-'))
        try {
            const bundle = join(directory, 'bundle'),
                reports = join(directory, 'reports'),
                root = join(directory, 'public')
            const expected = { ...identity, ...workflow, digest: 'sha256:' + 'b'.repeat(64) }
            await mkdir(bundle)
            await mkdir(reports)
            const amd = await platformFixture(join(directory, 'amd'), 'amd64'),
                arm = await platformFixture(join(directory, 'arm'), 'arm64')
            await writeFile(
                join(bundle, 'image-evidence.json'),
                JSON.stringify({
                    schemaVersion: 1,
                    ...expected,
                    native: [amd.evidence, arm.evidence],
                    portability: {
                        schemaVersion: 1,
                        ...identity,
                        sourceManifest: amd.runtime.digest,
                        targetManifest: arm.runtime.digest,
                        backupVersion: 4,
                        checks: 'amd64-backup-to-native-arm64',
                        nativeUpgradeSources: [],
                    },
                }),
            )
            for (const architecture of ['amd64', 'arm64']) {
                const release = parseDistributionRelease({
                    schemaVersion: 1,
                    ...expected,
                    platform: 'linux/' + architecture,
                    packageRevision: 1,
                })
                await buildDistributionPackages(
                    source,
                    join(bundle, 'packages', architecture),
                    release,
                )
                for (const target of ['debian', 'fedora'])
                    await writeFile(
                        join(reports, `native-${target}-${architecture}.json`),
                        JSON.stringify({
                            schemaVersion: 1,
                            ...expected,
                            architecture,
                            target,
                            passed: true,
                        }),
                    )
            }
            const bundleHash = await writeDistributionBundle(bundle, expected),
                home = join(directory, 'fixture-key')
            await mkdir(home, { mode: 0o700 })
            await distributionCommand([
                'gpg',
                '--homedir',
                home,
                '--batch',
                '--passphrase',
                '',
                '--quick-generate-key',
                'RentnerProxy publication fixture <fixture@example.invalid>',
                'rsa3072',
                'sign',
                '90d',
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
            const key = await distributionBytes([
                'gpg',
                '--homedir',
                home,
                '--batch',
                '--export-secret-keys',
                fingerprint,
            ])
            const options = {
                bundle,
                reports,
                source,
                publicRoot: root,
                assets: join(directory, 'assets'),
                identity: expected,
                bundleHash,
                key,
                fingerprint,
                previousFingerprints: [],
                baseUrl: 'https://example.com/packages',
                publishedAt: '2026-11-04T00:00:00.000Z',
            }
            expect(await signDistribution(options)).toHaveLength(2)
            const files = await bundleFiles(options.assets)
            expect(files).toContain('distribution.intoto.json.asc')
            expect(files.filter((file) => file.endsWith('.spdx.json'))).toHaveLength(2)
            const hashes = await Promise.all(
                files.map((file) => distributionFileHash(join(options.assets, file))),
            )
            const retry = join(directory, 'retry-assets')
            expect(
                await signDistribution({
                    ...options,
                    assets: retry,
                    identity: { ...expected, runAttempt: expected.runAttempt + 1 },
                }),
            ).toHaveLength(2)
            expect(await bundleFiles(retry)).toEqual(files)
            expect(
                await Promise.all(files.map((file) => distributionFileHash(join(retry, file)))),
            ).toEqual(hashes)
            await verifyRepositoryHistory(root, home, [fingerprint])
            const paths = await bundleFiles(root)
            validateRepositoryTree(
                Buffer.from(
                    paths.map((path) => `100644 blob ${'a'.repeat(40)}\tpublic/${path}\0`).join(''),
                ),
            )
            const provenance = JSON.parse(
                await readFile(join(options.assets, 'distribution.intoto.json'), 'utf8'),
            )
            expect(provenance.predicate.buildDefinition.externalParameters.digest).toBe(
                expected.digest,
            )
            expect(provenance.subject).toHaveLength(files.length - 2)
            // Tampering with a retained asset cannot become a new signed release retry.
            const retainedDeb = paths.find(
                (path) => path.startsWith('deliverables/') && path.endsWith('.deb'),
            )!
            await writeFile(join(root, retainedDeb), 'tampered retained package')
            await expect(
                signDistribution({ ...options, assets: join(directory, 'bad-retry') }),
            ).rejects.toThrow('checksum')
            await writeFile(join(root, 'catalog.json'), '[]')
            await expect(verifyRepositoryHistory(root, home, [fingerprint])).rejects.toThrow()
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    },
    120_000,
)
