// oxlint-disable no-await-in-loop -- The same isolated download is changed between substitution checks.
import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
    consumerCommand,
    consumerPackageVersion,
    verifyConsumerPackage,
} from '../../../../../.github/scripts/distribution/consumer.ts'
import { parseDistributionRelease } from '../../../../../.github/scripts/distribution/release.ts'
import { identity } from '../github/fixtures/oci.ts'

const release = parseDistributionRelease({
    schemaVersion: 1,
    ...identity,
    digest: 'sha256:' + 'b'.repeat(64),
    platform: 'linux/amd64',
    packageRevision: 1,
})
function entry(
    version = release.version,
    bytes = 'approved native package',
    platform = release.platform,
) {
    return {
        release: { ...release, version, platform },
        directory: `releases/${version}/1/${platform.split('/')[1]}`,
        files: ['deb', 'rpm', 'tar.gz'].map((extension) => ({
            file: `rentnerproxy-${version.slice(1)}-fixture.${extension}`,
            bytes: Buffer.byteLength(bytes),
            sha256: createHash('sha256').update(bytes).digest('hex'),
        })),
    }
}

test('published consumers pin the exact native release and reject an older valid download', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rp-consumer-'))
    try {
        await writeFile(
            join(root, 'catalog.json'),
            JSON.stringify([entry(), entry('v1.0.0-beta.2', 'older signed package')]),
        )
        expect(await consumerPackageVersion(root, 'debian', 'linux/amd64', release)).toBe(
            '1.0.0~beta.b3.a-1',
        )
        expect(await consumerPackageVersion(root, 'fedora', 'linux/amd64', release)).toBe(
            '1.0.0-0.beta.b3.a.1',
        )
        for (const target of ['debian', 'fedora'] as const) {
            const file = join(root, target === 'debian' ? 'apt_download.deb' : 'dnf_download.rpm')
            await writeFile(file, 'approved native package')
            await verifyConsumerPackage(root, target, 'linux/amd64', release)
            await writeFile(file, 'older signed package')
            await expect(
                verifyConsumerPackage(root, target, 'linux/amd64', release),
            ).rejects.toThrow('does not match')
            await verifyConsumerPackage(root, target, 'linux/amd64')
            await writeFile(file, 'unsigned substituted bytes')
            await expect(verifyConsumerPackage(root, target, 'linux/amd64')).rejects.toThrow(
                'does not match',
            )
        }
        await writeFile(join(root, 'extra.deb'), 'extra')
        await expect(verifyConsumerPackage(root, 'debian', 'linux/amd64', release)).rejects.toThrow(
            'one native',
        )
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('public consumer metadata must match source, image, architecture and a unique bounded catalog', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rp-consumer-catalog-'))
    try {
        const path = join(root, 'catalog.json')
        await writeFile(path, JSON.stringify([entry()]))
        for (const change of [
            { revision: 'c'.repeat(40) },
            { digest: 'sha256:' + 'c'.repeat(64) },
            { version: 'v1.0.0-beta.4' },
            { packageRevision: 2 },
        ])
            await expect(
                consumerPackageVersion(root, 'debian', 'linux/amd64', { ...release, ...change }),
            ).rejects.toThrow('exact requested')
        await expect(
            consumerPackageVersion(root, 'debian', 'linux/arm64', release),
        ).rejects.toThrow('architecture')
        await expect(consumerPackageVersion(root, 'debian', 'linux/arm64')).rejects.toThrow(
            'exact requested',
        )
        await writeFile(path, JSON.stringify([entry(), entry()]))
        await expect(
            consumerPackageVersion(root, 'debian', 'linux/amd64', release),
        ).rejects.toThrow('Duplicate')
        await writeFile(path, '{}')
        await expect(
            consumerPackageVersion(root, 'debian', 'linux/amd64', release),
        ).rejects.toThrow('history')
        await writeFile(path, ' '.repeat(2 * 1024 * 1024 + 1))
        await expect(
            consumerPackageVersion(root, 'debian', 'linux/amd64', release),
        ).rejects.toThrow('Invalid public')
        await rm(path)
        await mkdir(path)
        await expect(
            consumerPackageVersion(root, 'debian', 'linux/amd64', release),
        ).rejects.toThrow('Invalid public')
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('consumer commands distinguish exact release publication from metadata renewal and fail on incomplete identities', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rp-consumer-command-'))
    try {
        const platform = process.arch === 'arm64' ? 'linux/arm64' : 'linux/amd64'
        await writeFile(
            join(root, 'catalog.json'),
            JSON.stringify([entry(release.version, undefined, platform)]),
        )
        await writeFile(join(root, 'download.deb'), 'approved native package')
        const env = {
            TARGET: 'debian',
            RELEASE_VERSION: release.version,
            RELEASE_REVISION: release.revision,
            RELEASE_DIGEST: release.digest,
        }
        expect(await consumerCommand('version', root, env)).toBe('1.0.0~beta.b3.a-1')
        expect(await consumerCommand('verify', root, env)).toBe('')
        expect(await consumerCommand('version', root, { TARGET: 'debian' })).toBe('')
        await expect(consumerCommand('invalid', root, env)).rejects.toThrow('Expected version')
        await expect(
            consumerCommand('version', root, { ...env, TARGET: 'invalid' }),
        ).rejects.toThrow('target')
        await expect(
            consumerCommand('version', root, {
                TARGET: 'debian',
                RELEASE_VERSION: release.version,
            }),
        ).rejects.toThrow()
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})
