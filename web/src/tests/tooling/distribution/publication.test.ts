// oxlint-disable no-await-in-loop -- Deliberately mutate and verify the same proof between scenarios.
import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import {
    validateRepositoryTree,
    uploadReleaseAssets,
    validateNativeDistributionProofs,
    maintainerInstructions,
} from '../../../../../.github/scripts/distribution/publication.ts'
import {
    bundleFiles,
    distributionFileHash,
    verifyDistributionBundle,
    writeDistributionBundle,
} from '../../../../../.github/scripts/distribution/bundle.ts'
import { distributionAssetsFixture } from './fixtures/compact-assets.ts'
import { identity, platformFixture, workflow } from '../github/fixtures/oci.ts'

test('bounded bundles reserve space for their own manifest and retain separate producer limits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rp-bundle-bound-')),
        expected = { ...identity, ...workflow, digest: 'sha256:' + 'b'.repeat(64) }
    try {
        await writeFile(join(root, 'fixture'), 'data')
        await expect(bundleFiles(root, '', 0)).rejects.toThrow('file limit')
        await expect(bundleFiles(root, '', Infinity)).rejects.toThrow('file limit')
        await expect(writeDistributionBundle(root, expected, 1)).rejects.toThrow('too large')
        const hash = await writeDistributionBundle(root, expected, 2)
        await verifyDistributionBundle(root, hash, expected, 2)
        await writeFile(join(root, 'extra'), 'extra')
        await expect(verifyDistributionBundle(root, hash, expected, 2)).rejects.toThrow('too large')
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

function entry(path: string, mode = '100644') {
    return Buffer.from(`${mode} blob ${'a'.repeat(40)}\t${path}\0`)
}

test('repository history admits only nonexecutable public distribution data', () => {
    expect(() => validateRepositoryTree(entry('public/apt/dists/beta/InRelease'))).not.toThrow()
    expect(() =>
        validateRepositoryTree(
            entry('public/deliverables/v1.0.0-beta.3/distribution.intoto.json.asc'),
        ),
    ).not.toThrow()
    for (const path of [
        '.github/workflows/pwn.yml',
        'public/.gitattributes',
        'public/../pwn',
        'public/run.sh',
        'public/keys/private.key',
        'public/apt/evil.deb',
        'public/apt//evil',
    ])
        expect(() => validateRepositoryTree(entry(path))).toThrow()
    for (const mode of ['100755', '120000', '160000'])
        expect(() => validateRepositoryTree(entry('public/index.html', mode))).toThrow()
    expect(maintainerInstructions()).toContain('PACKAGE_PREVIOUS_FINGERPRINTS')
    expect(maintainerInstructions()).toContain('Valid-Until')
})

test('bundle checks bind source, image, workflow and every file, allowing safe failed-job reruns', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rp-bundle-'))
    const expected = { ...identity, ...workflow, digest: 'sha256:' + 'b'.repeat(64) }
    try {
        await mkdir(join(root, 'metadata'))
        await writeFile(join(root, 'metadata/empty-Packages'), '')
        const hash = await writeDistributionBundle(root, expected)
        await verifyDistributionBundle(root, hash, {
            ...expected,
            runAttempt: workflow.runAttempt + 1,
        })
        await expect(
            verifyDistributionBundle(root, hash, { ...expected, runId: '12346' }),
        ).rejects.toThrow('identity')
        await expect(
            verifyDistributionBundle(root, hash, { ...expected, runAttempt: 1 }),
        ).rejects.toThrow('identity')
        await expect(verifyDistributionBundle(root, 'c'.repeat(64), expected)).rejects.toThrow(
            'checksum',
        )
        await writeFile(join(root, 'extra'), 'unexpected')
        await expect(verifyDistributionBundle(root, hash, expected)).rejects.toThrow('Unexpected')
        await rm(join(root, 'extra'))
        await writeFile(join(root, 'metadata/empty-Packages'), 'changed')
        await expect(verifyDistributionBundle(root, hash, expected)).rejects.toThrow('substituted')
        await writeFile(join(root, 'bad name'), 'x')
        await expect(bundleFiles(root)).rejects.toThrow('path')
        await expect(distributionFileHash(join(root, 'metadata'))).rejects.toThrow()
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('all four native distribution reports must bind the same assessed image and source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rp-native-proof-'))
    try {
        const amd = await platformFixture(join(root, 'amd'), 'amd64'),
            arm = await platformFixture(join(root, 'arm'), 'arm64')
        const expected = { ...identity, ...workflow, digest: 'sha256:' + 'b'.repeat(64) }
        const evidence = {
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
        }
        await writeFile(join(root, 'image-evidence.json'), JSON.stringify(evidence))
        for (const target of ['debian', 'fedora'])
            for (const architecture of ['amd64', 'arm64'])
                await writeFile(
                    join(root, `native-${target}-${architecture}.json`),
                    JSON.stringify({
                        schemaVersion: 1,
                        ...expected,
                        target,
                        architecture,
                        passed: true,
                    }),
                )
        await validateNativeDistributionProofs(root, root, expected)
        const file = join(root, 'native-fedora-arm64.json'),
            original = await readFile(file, 'utf8')
        for (const change of [
            { digest: 'sha256:' + 'c'.repeat(64) },
            { revision: 'c'.repeat(40) },
            { architecture: 'amd64' },
            { passed: false },
            { runAttempt: 99 },
        ]) {
            await writeFile(file, JSON.stringify({ ...JSON.parse(original), ...change }))
            await expect(validateNativeDistributionProofs(root, root, expected)).rejects.toThrow(
                'gate',
            )
        }
        await writeFile(file, original)
        evidence.portability.targetManifest = 'sha256:' + 'c'.repeat(64)
        await writeFile(join(root, 'image-evidence.json'), JSON.stringify(evidence))
        await expect(validateNativeDistributionProofs(root, root, expected)).rejects.toThrow(
            'portability',
        )
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('release asset publication reuses identical checksums and refuses conflicting retries or changed releases', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rp-release-assets-'))
    try {
        await distributionAssetsFixture(root)
        const calls: readonly string[][] = []
        const actions: string[][] = calls as string[][]
        let assets: { name: string; digest: string }[] = [],
            tag = identity.version
        const command = async (args: readonly string[]) => {
            actions.push([...args])
            if (args[1] === 'api') return JSON.stringify({ tag_name: tag, draft: false, assets })
            const path = args[4]!
            assets.push({
                name: basename(path),
                digest: 'sha256:' + (await distributionFileHash(path)),
            })
            return ''
        }
        const options = { tag: identity.version, releaseId: '123', command }
        await uploadReleaseAssets(root, options)
        expect(actions.filter((args) => args[1] === 'release')).toHaveLength(8)
        expect(actions[0]).toEqual(['gh', 'api', 'repos/RentnerProxy/RentnerProxy/releases/123'])
        for (const action of actions.filter((args) => args[1] === 'release'))
            expect(action.slice(-2)).toEqual(['--repo', 'RentnerProxy/RentnerProxy'])
        expect(assets.filter((asset) => /\.(deb|rpm|tar\.gz)$/.test(asset.name))).toHaveLength(7)
        expect(assets.some((asset) => asset.name === 'distribution.intoto.json')).toBeFalse()
        actions.length = 0
        await uploadReleaseAssets(root, options)
        expect(actions.filter((args) => args[1] === 'release')).toHaveLength(0)
        assets[0]!.digest = 'sha256:' + 'c'.repeat(64)
        await expect(uploadReleaseAssets(root, options)).rejects.toThrow('collision')
        tag = 'v2.0.0'
        await expect(uploadReleaseAssets(root, options)).rejects.toThrow('identity')
        await expect(uploadReleaseAssets(root, { ...options, releaseId: 'evil' })).rejects.toThrow(
            'ID',
        )
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})
