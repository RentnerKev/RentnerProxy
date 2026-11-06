// oxlint-disable no-await-in-loop -- Verify release proofs and immutable downloads before publication.
import { copyFile, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { ociRecord, ociText } from '../lib/oci-layout.ts'
import { parseNativeImageEvidence, parsePortabilityEvidence } from '../release/multiarch-image.ts'
import { verifyDistributionBundle, bundleFiles, distributionFileHash } from './bundle.ts'
import { distributionWorkflowIdentity } from './prepare.ts'
import { distributionPayload } from './payload.ts'
import { parseDistributionRelease, distributionPackageVersion } from './release.ts'
import { distributionCommand } from './process.ts'
import { verifyImmutableRepositoryManifest, writeImmutableRepositoryManifest } from './history.ts'
import { maximumRepositoryFiles } from './limits.ts'
import { prepareCompactReleaseAssets } from './compact-assets.ts'
import {
    readRepositoryCatalog,
    repositoryUrl,
    signingFingerprint,
    updatePackageRepository,
    withSigningKey,
} from './repository.ts'

export function validateRepositoryTree(bytes: Uint8Array): void {
    const entries = Buffer.from(bytes).toString('utf8').split('\0').filter(Boolean)
    if (entries.length > maximumRepositoryFiles) throw new Error('Repository history is too large')
    for (const entry of entries) {
        const match = /^100644 blob [a-f0-9]{40}\t(public\/[A-Za-z0-9_./+-]+)$/u.exec(entry)
        const path = match?.[1] || ''
        const approved =
            /^public\/(?:keys\/(?:[A-F0-9]{40}|rentnerproxy)\.asc|apt\/(?:pool\/main\/rentnerproxy-[A-Za-z0-9_.-]+\.deb|dists\/(?:alpha|beta|stable)\/(?:InRelease|Release(?:\.gpg)?|main\/binary-(?:amd64|arm64)\/Packages(?:\.gz)?))|rpm\/(?:alpha|beta|stable)\/(?:x86_64|aarch64)\/(?:Packages\/rentnerproxy-[A-Za-z0-9_.-]+\.rpm|repodata\/(?:repomd\.xml(?:\.asc)?|[a-f0-9]{64}-[A-Za-z0-9_.-]+))|releases\/v[A-Za-z0-9_.-]+\/[1-9][0-9]*\/(?:amd64|arm64)\/(?:rentnerproxy-[A-Za-z0-9_.-]+\.(?:deb|rpm|tar\.gz)|SHA256SUMS(?:\.asc)?|release\.json(?:\.asc)?|INSTALL\.txt)|deliverables\/v[A-Za-z0-9_.-]+\/(?:rentnerproxy-[A-Za-z0-9_.-]+|native-[A-Za-z0-9_.-]+\.json|assessed-image-evidence\.json|distribution\.intoto\.json(?:\.asc)?|[A-F0-9]{40}\.asc|MAINTAINER\.txt)|(?:catalog|immutable-files)\.json(?:\.asc)?|INSTALL\.txt|index\.html)$/u.test(
                path,
            )
        if (!match || !approved || path.split('/').some((part) => !part || part.startsWith('.')))
            throw new Error('Only public data files are permitted in the package repository branch')
    }
}

export async function validateNativeDistributionProofs(
    bundle: string,
    reports: string,
    identity: ReturnType<typeof distributionWorkflowIdentity>,
): Promise<void> {
    const raw = ociRecord(JSON.parse(await readFile(join(bundle, 'image-evidence.json'), 'utf8')))
    if (
        raw.schemaVersion !== 1 ||
        raw.digest !== identity.digest ||
        raw.revision !== identity.revision ||
        raw.version !== identity.version ||
        raw.runId !== identity.runId ||
        !Array.isArray(raw.native) ||
        raw.native.length !== 2
    )
        throw new Error('Invalid assessed image evidence')
    const nativeEntries = raw.native
    const native = (['amd64', 'arm64'] as const).map((architecture, index) =>
        parseNativeImageEvidence(
            nativeEntries[index],
            identity,
            architecture,
            identity.runId,
            identity.runAttempt,
        ),
    )
    const portability = parsePortabilityEvidence(raw.portability, identity)
    if (
        portability.sourceManifest !== native[0]!.manifestDigest ||
        portability.targetManifest !== native[1]!.manifestDigest
    )
        throw new Error('Invalid image portability binding')
    for (const architecture of ['amd64', 'arm64'])
        for (const target of ['debian', 'fedora']) {
            const path = join(reports, `native-${target}-${architecture}.json`),
                info = await lstat(path)
            if (!info.isFile() || info.size > 4096)
                throw new Error('Invalid native distribution report')
            const report = ociRecord(JSON.parse(await readFile(path, 'utf8')))
            if (
                report.schemaVersion !== 1 ||
                report.architecture !== architecture ||
                report.target !== target ||
                report.passed !== true ||
                Object.entries(identity).some(
                    ([key, value]) => key !== 'runAttempt' && report[key] !== value,
                ) ||
                typeof report.runAttempt !== 'number' ||
                !Number.isSafeInteger(report.runAttempt) ||
                report.runAttempt < 1 ||
                report.runAttempt > identity.runAttempt
            )
                throw new Error('Missing or mismatched native distribution gate')
        }
}

export function maintainerInstructions(): string {
    return `First release setup (owner only; never needed for PR validation):
1. Enable GitHub Pages with source GitHub Actions in RentnerKev/RentnerProxy.
2. Protect environment package-signing: restrict deployments to trusted release
   tags/default-branch renewal, add required reviewers if desired, and prevent
   untrusted branches from accessing it. Protect the package-repository branch
   against deletion/force pushes and changes outside the release workflow.
3. Create a dedicated expiring OpenPGP release key offline. Keep the certification
   primary and its revocation certificate offline. Export ONLY a signing subkey
   (gpg --armor --export-secret-subkeys FINGERPRINT) into the protected environment
   secret PACKAGE_SIGNING_KEY. The runner requires that subkey to be usable in
   batch mode without an interactive passphrase. Never store it in the repository,
   artifacts, caches or logs. Replace the secret if a runner/key is compromised.
4. Set environment variable PACKAGE_SIGNING_FINGERPRINT to the complete uppercase
   40-hex PRIMARY fingerprint. Optionally set repository variable
   PACKAGE_REPOSITORY_URL for a configured HTTPS Pages custom domain; default is
   https://rentnerkev.github.io/RentnerProxy. Public-key setup is scoped per repo.
5. Announce the fingerprint through an independent owner-controlled channel before
   the first release. PRs use disposable fixture keys and never publish a site.

Rotation and expiry:
The signer refuses revoked/expired keys or keys expiring within 30 days. Use a
one-year expiry and rotate well before that cutoff. Retain old public keys and
immutable signatures. During rotation, add the old full fingerprints to the
protected PACKAGE_PREVIOUS_FINGERPRINTS variable (comma separated), publish the
new public fingerprint independently, and have consumers add the new public key
to their dedicated keyring before switching signatures. Never auto-trust a new
key downloaded from a failed signature response. Remove old consumer trust only
after the overlap period and migration; keep public keys for old release assets.
The weekly trusted renewal workflow refreshes signed APT metadata with a 35-day
Valid-Until; failures surface as CI failures and must be repaired before expiry.
Never disable Valid-Until, Signed-By, gpgcheck or repo_gpgcheck to recover.

All distribution artifacts bind the exact source SHA and assessed OCI root,
including its per-platform SBOM/provenance. The data-only repository branch keeps
immutable package versions; publication refuses a conflicting retry. Channel
indexes are rebuilt only after native Debian/Fedora AMD64/ARM64 gates pass.
The signed immutable-files.json covers retained release guides, packages, keys
and deliverables. Renewal verifies this complete record before publishing.
Capacity is bounded to 1,000 architecture entries (500 dual-architecture releases)
and 32,768 staged files, budgeted against the real emitted file count in CI.
Before reaching that catalog limit, introduce a new repository epoch while
preserving the previous anonymous URLs and keys; never prune immutable versions
silently. Capacity exhaustion stops signing before any release publication.
Signing finishes before any image tag is published. The publisher verifies the
sealed public snapshot and its exact data-branch parent without a signing key.
If that parent changed, rerun signing and dependent jobs; never force-push it.
Normal PRs do not run a long soak test. Release preparation remains separate.
`
}

export async function verifyRepositoryHistory(
    root: string,
    home: string,
    allowedFingerprints: readonly string[],
) {
    for (const fingerprint of allowedFingerprints) {
        signingFingerprint(fingerprint)
        const key = join(root, 'keys', fingerprint + '.asc')
        if (!(await lstat(key).catch(() => null))) continue
        const bytes = await readFile(key)
        if (bytes.length > 131072 || bytes.includes(Buffer.from('PRIVATE KEY')))
            throw new Error('Invalid public repository key')
        const imported = await distributionCommand(
            [
                'gpg',
                '--homedir',
                home,
                '--batch',
                '--with-colons',
                '--import-options',
                'show-only',
                '--import',
            ],
            { input: bytes },
        )
        if (
            imported
                .split('\n')
                .find((line) => line.startsWith('fpr:'))
                ?.split(':')[9] !== fingerprint ||
            imported.split('\n').filter((line) => line.startsWith('pub:')).length !== 1
        )
            throw new Error('Repository public key fingerprint mismatch')
        await distributionCommand(['gpg', '--homedir', home, '--batch', '--import'], {
            input: bytes,
        })
    }
    await distributionCommand([
        'gpg',
        '--homedir',
        home,
        '--batch',
        '--no-auto-key-retrieve',
        '--verify',
        join(root, 'catalog.json.asc'),
        join(root, 'catalog.json'),
    ])
    await readRepositoryCatalog(root)
    await verifyImmutableRepositoryManifest(root, home)
}

export async function signDistribution(options: {
    readonly bundle: string
    readonly reports: string
    readonly source: string
    readonly publicRoot: string
    readonly assets: string
    readonly identity: ReturnType<typeof distributionWorkflowIdentity>
    readonly bundleHash: string
    readonly key: Uint8Array
    readonly fingerprint: string
    readonly previousFingerprints: readonly string[]
    readonly baseUrl: string
    readonly publishedAt: string
}) {
    await verifyDistributionBundle(options.bundle, options.bundleHash, options.identity)
    await validateNativeDistributionProofs(options.bundle, options.reports, options.identity)
    const artifacts = (['amd64', 'arm64'] as const).map((architecture) => ({
        directory: join(options.bundle, 'packages', architecture),
        release: parseDistributionRelease({
            schemaVersion: 1,
            ...options.identity,
            platform: 'linux/' + architecture,
            packageRevision: 1,
        }),
    }))
    const fingerprint = signingFingerprint(options.fingerprint)
    await mkdir(options.assets, { recursive: true })
    return withSigningKey(options.key, fingerprint, async (home) => {
        if (await lstat(join(options.publicRoot, 'catalog.json')).catch(() => null))
            await verifyRepositoryHistory(options.publicRoot, home, [
                fingerprint,
                ...options.previousFingerprints,
            ])
        const entries = await updatePackageRepository({
            root: options.publicRoot,
            source: options.source,
            artifacts,
            home,
            fingerprint,
            baseUrl: options.baseUrl,
        })
        const retainedAssets = join(options.publicRoot, 'deliverables', options.identity.version)
        if (await lstat(retainedAssets).catch(() => null)) {
            await distributionCommand([
                'gpg',
                '--homedir',
                home,
                '--batch',
                '--no-auto-key-retrieve',
                '--verify',
                join(retainedAssets, 'distribution.intoto.json.asc'),
                join(retainedAssets, 'distribution.intoto.json'),
            ])
            const retained = ociRecord(
                JSON.parse(
                    await readFile(join(retainedAssets, 'distribution.intoto.json'), 'utf8'),
                ),
            )
            const parameters = ociRecord(
                ociRecord(ociRecord(retained.predicate).buildDefinition).externalParameters,
            )
            if (
                parameters.revision !== options.identity.revision ||
                parameters.version !== options.identity.version ||
                parameters.digest !== options.identity.digest ||
                !Array.isArray(retained.subject)
            )
                throw new Error('Immutable release deliverable identity collision')
            const files = (await bundleFiles(retainedAssets)).filter(
                (file) => !file.startsWith('distribution.intoto.json'),
            )
            if (retained.subject.length !== files.length)
                throw new Error('Unexpected retained release deliverables')
            for (const file of files) {
                const subject = retained.subject.map(ociRecord).find((entry) => entry.name === file)
                if (
                    !subject ||
                    ociRecord(subject.digest).sha256 !==
                        (await distributionFileHash(join(retainedAssets, file)))
                )
                    throw new Error('Retained release asset checksum mismatch')
            }
            for (const file of await bundleFiles(retainedAssets))
                await copyFile(join(retainedAssets, file), join(options.assets, file))
            await writeImmutableRepositoryManifest(options.publicRoot, home, fingerprint)
            return entries
        }
        const selected = entries.filter(
            (entry) =>
                entry.release.version === options.identity.version &&
                entry.release.revision === options.identity.revision &&
                entry.release.packageRevision === 1,
        )
        if (selected.length !== 2) throw new Error('Missing signed native package versions')
        for (const entry of selected) {
            const directory = join(options.publicRoot, entry.directory),
                architecture = entry.release.platform.split('/')[1]!
            for (const file of [
                ...entry.files.map((candidate) => candidate.file),
                'SHA256SUMS',
                'SHA256SUMS.asc',
                'release.json',
                'release.json.asc',
                'INSTALL.txt',
            ]) {
                const name = entry.files.some((candidate) => candidate.file === file)
                    ? file
                    : `rentnerproxy-${options.identity.version}-${architecture}-${file}`
                await copyFile(join(directory, file), join(options.assets, name))
            }
            const payload = await distributionPayload(options.source, entry.release)
            const sbom = {
                spdxVersion: 'SPDX-2.3',
                dataLicense: 'CC0-1.0',
                SPDXID: 'SPDXRef-DOCUMENT',
                name: 'RentnerProxy ' + options.identity.version + ' Linux ' + architecture,
                documentNamespace: `https://github.com/RentnerKev/RentnerProxy/distribution/${options.identity.revision}/${architecture}`,
                creationInfo: {
                    creators: ['Tool: RentnerProxy trusted distribution publisher'],
                    created: options.publishedAt,
                },
                files: payload.map((file, index) => ({
                    fileName: './' + file.path,
                    SPDXID: 'SPDXRef-File-' + index,
                    checksums: [
                        {
                            algorithm: 'SHA256',
                            checksumValue: createHash('sha256').update(file.content).digest('hex'),
                        },
                    ],
                })),
            }
            await writeFile(
                join(
                    options.assets,
                    `rentnerproxy-${options.identity.version}-${architecture}.spdx.json`,
                ),
                JSON.stringify(sbom) + '\n',
            )
        }
        for (const file of await bundleFiles(options.reports))
            await copyFile(join(options.reports, file), join(options.assets, file))
        await copyFile(
            join(options.bundle, 'image-evidence.json'),
            join(options.assets, 'assessed-image-evidence.json'),
        )
        await copyFile(
            join(options.publicRoot, 'keys', fingerprint + '.asc'),
            join(options.assets, fingerprint + '.asc'),
        )
        await writeFile(join(options.assets, 'MAINTAINER.txt'), maintainerInstructions())
        const files = await Promise.all(
            (await bundleFiles(options.assets)).map(async (file) => ({
                file,
                sha256: await distributionFileHash(join(options.assets, file)),
            })),
        )
        const statement = {
            _type: 'https://in-toto.io/Statement/v1',
            subject: files.map((file) => ({ name: file.file, digest: { sha256: file.sha256 } })),
            predicateType: 'https://slsa.dev/provenance/v1',
            predicate: {
                buildDefinition: {
                    buildType: 'https://github.com/RentnerKev/RentnerProxy/linux-distribution/v1',
                    externalParameters: options.identity,
                    resolvedDependencies: [
                        {
                            uri: 'git+https://github.com/RentnerKev/RentnerProxy',
                            digest: { gitCommit: options.identity.revision },
                        },
                        {
                            uri: 'pkg:oci/rentnerproxy@' + options.identity.digest,
                            digest: { sha256: options.identity.digest.slice(7) },
                        },
                    ],
                },
                runDetails: {
                    builder: {
                        id: 'https://github.com/RentnerKev/RentnerProxy/.github/workflows/sign-distribution.yml',
                    },
                    metadata: {
                        invocationId: `https://github.com/RentnerKev/RentnerProxy/actions/runs/${options.identity.runId}/attempts/${options.identity.runAttempt}`,
                    },
                },
            },
        }
        const provenance = join(options.assets, 'distribution.intoto.json')
        await writeFile(provenance, JSON.stringify(statement) + '\n')
        await distributionCommand([
            'gpg',
            '--homedir',
            home,
            '--batch',
            '--yes',
            '--local-user',
            fingerprint,
            '--armor',
            '--detach-sign',
            provenance,
        ])
        await mkdir(retainedAssets, { recursive: true })
        for (const file of await bundleFiles(options.assets))
            await copyFile(join(options.assets, file), join(retainedAssets, file))
        await writeImmutableRepositoryManifest(options.publicRoot, home, fingerprint)
        return entries
    })
}

export async function uploadReleaseAssets(
    directory: string,
    options: { tag: string; releaseId: string; command?: typeof distributionCommand } = {
        tag: ociText(process.env.VERSION),
        releaseId: ociText(process.env.RELEASE_ID),
    },
) {
    const { tag, releaseId } = options
    const command = options.command ?? distributionCommand
    distributionPackageVersion(tag)
    if (!/^\d+$/u.test(releaseId)) throw new Error('Invalid authoritative release ID')
    const staging = await mkdtemp(join(tmpdir(), 'rentnerproxy-compact-publication-'))
    try {
        await prepareCompactReleaseAssets(directory, staging, tag)
        const release = ociRecord(
            JSON.parse(
                await command(['gh', 'api', 'repos/RentnerKev/RentnerProxy/releases/' + releaseId]),
            ),
        )
        if (release.tag_name !== tag || release.draft !== false || !Array.isArray(release.assets))
            throw new Error('Release identity changed')
        for (const file of await bundleFiles(staging)) {
            if (file.includes('/')) throw new Error('Nested release asset')
            const existing = release.assets.map(ociRecord).find((asset) => asset.name === file)
            const path = join(staging, file)
            if (existing) {
                // GitHub exposes the server-side asset digest; avoid mutating immutable retries.
                if (existing.digest !== 'sha256:' + (await distributionFileHash(path)))
                    throw new Error('Immutable GitHub release asset collision')
            } else
                await command([
                    'gh',
                    'release',
                    'upload',
                    tag,
                    path,
                    '--repo',
                    'RentnerKev/RentnerProxy',
                ])
        }
    } finally {
        await rm(staging, { recursive: true, force: true })
    }
}

export async function refreshDistribution(options: {
    root: string
    source: string
    key: Uint8Array
    fingerprint: string
    previousFingerprints: readonly string[]
    baseUrl: string
}) {
    return withSigningKey(options.key, options.fingerprint, async (home) => {
        await verifyRepositoryHistory(options.root, home, [
            options.fingerprint,
            ...options.previousFingerprints,
        ])
        const entries = await updatePackageRepository({
            root: options.root,
            source: options.source,
            fingerprint: options.fingerprint,
            baseUrl: options.baseUrl,
            artifacts: [],
            home,
        })
        await writeImmutableRepositoryManifest(options.root, home, options.fingerprint)
        return entries
    })
}

if (import.meta.main) {
    const action = process.argv[2]
    if (action === 'validate-tree') validateRepositoryTree(await readFile(ociText(process.argv[3])))
    else if (action === 'sign') {
        const env = process.env
        const key = Buffer.from(env.PACKAGE_SIGNING_KEY || '')
        delete process.env.PACKAGE_SIGNING_KEY
        await signDistribution({
            bundle: resolve(ociText(env.DISTRIBUTION_DIRECTORY)),
            reports: resolve(ociText(env.NATIVE_REPORT_DIRECTORY)),
            source: resolve(ociText(env.SOURCE_DIRECTORY)),
            publicRoot: resolve(ociText(env.PUBLIC_DIRECTORY)),
            assets: resolve(ociText(env.RELEASE_ASSET_DIRECTORY)),
            identity: distributionWorkflowIdentity(),
            bundleHash: ociText(env.BUNDLE_SHA256),
            key,
            fingerprint: signingFingerprint(ociText(env.PACKAGE_SIGNING_FINGERPRINT)),
            previousFingerprints: (env.PACKAGE_PREVIOUS_FINGERPRINTS || '')
                .split(',')
                .filter(Boolean)
                .map(signingFingerprint),
            baseUrl: repositoryUrl(
                env.PACKAGE_REPOSITORY_URL || 'https://rentnerkev.github.io/RentnerProxy',
            ),
            publishedAt: ociText(env.RELEASE_PUBLISHED_AT),
        })
    } else if (action === 'refresh') {
        const env = process.env,
            key = Buffer.from(env.PACKAGE_SIGNING_KEY || '')
        delete process.env.PACKAGE_SIGNING_KEY
        const root = resolve(ociText(env.PUBLIC_DIRECTORY)),
            fingerprint = signingFingerprint(ociText(env.PACKAGE_SIGNING_FINGERPRINT))
        await refreshDistribution({
            root,
            key,
            fingerprint,
            previousFingerprints: (env.PACKAGE_PREVIOUS_FINGERPRINTS || '')
                .split(',')
                .filter(Boolean)
                .map(signingFingerprint),
            source: resolve(ociText(env.SOURCE_DIRECTORY)),
            baseUrl: repositoryUrl(
                env.PACKAGE_REPOSITORY_URL || 'https://rentnerkev.github.io/RentnerProxy',
            ),
        })
    } else if (action === 'upload')
        await uploadReleaseAssets(resolve(ociText(process.env.RELEASE_ASSET_DIRECTORY)))
    else throw new Error('Expected validate-tree, sign, refresh or upload')
}
