// oxlint-disable no-await-in-loop -- Build both package architectures and fixture repositories from one verified image.
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { hashOciFile, ociText } from '../lib/oci-layout.ts'
import { verifyMultiarchImage } from '../release/multiarch-image.ts'
import { buildDistributionPackages } from './packages.ts'
import { parseDistributionRelease } from './release.ts'
import { distributionBytes, distributionCommand } from './process.ts'
import { updatePackageRepository, withSigningKey } from './repository.ts'
import { verifyDistributionBundle, writeDistributionBundle } from './bundle.ts'
import type { DistributionRelease } from './Types/distribution.types.ts'

export function distributionWorkflowIdentity() {
    const env = process.env
    const identity = {
        revision: ociText(env.REVISION),
        version: ociText(env.VERSION),
        digest: ociText(env.EXPECTED_DIGEST),
        runId: ociText(env.GITHUB_RUN_ID),
        runAttempt: Number(env.GITHUB_RUN_ATTEMPT),
    }
    parseDistributionRelease({
        schemaVersion: 1,
        ...identity,
        platform: 'linux/amd64',
        packageRevision: 1,
    })
    if (
        !/^[1-9][0-9]*$/u.test(identity.runId) ||
        !Number.isSafeInteger(identity.runAttempt) ||
        identity.runAttempt < 1
    )
        throw new Error('Invalid distribution workflow identity')
    return identity
}

async function prepare() {
    const env = process.env,
        identity = distributionWorkflowIdentity()
    const source = resolve(ociText(env.SOURCE_DIRECTORY)),
        output = resolve(ociText(env.DISTRIBUTION_DIRECTORY)),
        candidate = resolve(ociText(env.CANDIDATE_DIRECTORY))
    if (
        (await hashOciFile(join(candidate, 'candidate-image.tar'))).slice(7) !==
            env.ARCHIVE_SHA256 ||
        (await hashOciFile(join(candidate, 'evidence.json'))).slice(7) !== env.EVIDENCE_SHA256
    )
        throw new Error('Assessed image artifact checksum mismatch')
    const temporary = await mkdtemp(join(tmpdir(), 'rentnerproxy-distribution-'))
    try {
        const layout = join(temporary, 'layout')
        await distributionCommand(
            [
                'skopeo',
                'copy',
                '--all',
                '--preserve-digests',
                'oci-archive:' + join(candidate, 'candidate-image.tar'),
                'oci:' + layout + ':candidate',
            ],
            { timeoutMs: 360_000 },
        )
        const evidence = await verifyMultiarchImage(
            layout,
            JSON.parse(await readFile(join(candidate, 'evidence.json'), 'utf8')),
            identity,
            identity.runId,
            identity.runAttempt,
        )
        if (evidence.digest !== identity.digest) throw new Error('Distribution image root mismatch')
        await mkdir(output, { recursive: true })
        const artifacts: { directory: string; release: DistributionRelease }[] = []
        const upgrades: typeof artifacts = []
        for (const platform of ['linux/amd64', 'linux/arm64'] as const)
            for (const packageRevision of [1, 2]) {
                const release = parseDistributionRelease({
                    schemaVersion: 1,
                    ...identity,
                    platform,
                    packageRevision,
                })
                const directory = join(
                    output,
                    packageRevision === 1 ? 'packages' : 'upgrade',
                    platform.split('/')[1]!,
                )
                await buildDistributionPackages(source, directory, release)
                ;(packageRevision === 1 ? artifacts : upgrades).push({ directory, release })
            }
        await writeFile(join(output, 'image-evidence.json'), JSON.stringify(evidence) + '\n')
        const home = join(temporary, 'fixture-key')
        await mkdir(home, { mode: 0o700 })
        await distributionCommand([
            'gpg',
            '--homedir',
            home,
            '--batch',
            '--passphrase',
            '',
            '--quick-generate-key',
            'RentnerProxy CI fixture <fixture@example.invalid>',
            'rsa3072',
            'sign',
            '90d',
        ])
        const fingerprint = (
            await distributionCommand(['gpg', '--homedir', home, '--with-colons', '--list-keys'])
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
        await withSigningKey(key, fingerprint, async (signingHome) => {
            for (const [name, versions] of [
                ['repo-initial', artifacts],
                ['repo-upgrade', [...artifacts, ...upgrades]],
            ] as const)
                await updatePackageRepository({
                    root: join(output, name),
                    source,
                    artifacts: versions,
                    home: signingHome,
                    fingerprint,
                    baseUrl: 'https://fixture.invalid',
                })
        })
        await writeFile(join(output, 'fixture-fingerprint'), fingerprint + '\n')
        await distributionCommand([
            'bun',
            '--no-env-file',
            'build',
            join(source, '.github/scripts/ci/distribution/native-probe.ts'),
            '--target=bun',
            '--outfile=' + join(output, 'native-probe.js'),
        ])
        const hash = await writeDistributionBundle(output, identity)
        if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, 'bundle_sha256=' + hash + '\n')
    } finally {
        await rm(temporary, { recursive: true, force: true })
    }
}

if (import.meta.main) {
    if (process.argv[2] === 'verify')
        await verifyDistributionBundle(
            resolve(ociText(process.env.DISTRIBUTION_DIRECTORY)),
            ociText(process.env.BUNDLE_SHA256),
            distributionWorkflowIdentity(),
        )
    else if (process.argv[2] === 'build') await prepare()
    else throw new Error('Expected build or verify')
}
