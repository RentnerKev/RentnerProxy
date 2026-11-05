// oxlint-disable no-await-in-loop -- Verify failures preserve the same publication staging directory.
import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
    restoreSignedDistribution,
    sealSignedDistribution,
    signedDistributionCommand,
} from '../../../../../.github/scripts/distribution/signed.ts'
import { distributionFileHash } from '../../../../../.github/scripts/distribution/bundle.ts'
import { identity, workflow } from '../github/fixtures/oci.ts'

const expected = { ...identity, ...workflow, digest: 'sha256:' + 'b'.repeat(64) }
const fingerprint = 'A'.repeat(40)
const baseUrl = 'https://packages.fixture.invalid'

async function fixture(root: string) {
    const repository = join(root, 'repository'),
        assets = join(root, 'assets'),
        output = join(root, 'sealed')
    await mkdir(join(repository, '.git'), { recursive: true })
    await mkdir(join(repository, 'public'))
    await mkdir(assets)
    await writeFile(join(repository, '.git/rentnerproxy-parent'), 'initial\n')
    await writeFile(join(repository, 'public/catalog.json'), '[]\n')
    await writeFile(join(repository, 'public/catalog.json.asc'), 'public signature fixture\n')
    await writeFile(join(assets, 'fixture.deb'), 'approved package bytes\n')
    return { repository, assets, output, identity: expected, fingerprint, baseUrl }
}

test('signed publication transfers exact bytes and refuses stale history or substituted artifacts before writes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rp-signed-'))
    try {
        const options = await fixture(root),
            result = await sealSignedDistribution(options),
            assets = join(root, 'published-assets'),
            restore = {
                input: options.output,
                repository: options.repository,
                assets,
                expectedHash: result.sha256,
                identity: expected,
            }
        expect(result).toMatchObject({ fingerprint, baseUrl })
        await mkdir(join(options.repository, 'public'))
        const sentinel = join(options.repository, 'public/INSTALL.txt')
        await writeFile(sentinel, 'preserve on failure')
        await writeFile(join(options.repository, '.git/rentnerproxy-parent'), 'c'.repeat(40))
        await expect(restoreSignedDistribution(restore)).rejects.toThrow('changed since signing')
        expect(await readFile(sentinel, 'utf8')).toBe('preserve on failure')
        await writeFile(join(options.repository, '.git/rentnerproxy-parent'), 'initial\n')
        const packageFile = join(options.output, 'assets/fixture.deb')
        await writeFile(packageFile, 'substituted package')
        await expect(restoreSignedDistribution(restore)).rejects.toThrow('substituted')
        expect(await readFile(sentinel, 'utf8')).toBe('preserve on failure')
        await writeFile(packageFile, 'approved package bytes\n')
        expect(await restoreSignedDistribution(restore)).toEqual({ fingerprint, baseUrl })
        expect(await readFile(join(assets, 'fixture.deb'), 'utf8')).toBe('approved package bytes\n')
        expect(await distributionFileHash(join(options.repository, 'public/catalog.json'))).toBe(
            await distributionFileHash(join(options.output, 'public/catalog.json')),
        )
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('sealing refuses overlapping directories, executable repository data and missing catalog/parent bindings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rp-signed-invalid-'))
    try {
        const options = await fixture(root)
        for (const output of [options.repository, join(options.repository, 'nested'), root])
            await expect(sealSignedDistribution({ ...options, output })).rejects.toThrow(
                'Overlapping',
            )
        await expect(
            sealSignedDistribution({ ...options, assets: options.repository }),
        ).rejects.toThrow('Overlapping')
        await writeFile(join(options.repository, 'public/run.sh'), 'unapproved')
        await expect(sealSignedDistribution(options)).rejects.toThrow('Only public data')
        await rm(join(options.repository, 'public/run.sh'))
        await rm(join(options.repository, 'public/catalog.json.asc'))
        await expect(sealSignedDistribution(options)).rejects.toThrow(
            'Missing signed package catalog',
        )
        await writeFile(join(options.repository, 'public/catalog.json.asc'), 'signature')
        const parent = join(options.repository, '.git/rentnerproxy-parent')
        for (const value of ['invalid', 'a'.repeat(65)]) {
            await writeFile(parent, value)
            await expect(sealSignedDistribution(options)).rejects.toThrow('parent binding')
        }
        await rm(parent)
        await mkdir(parent)
        await expect(sealSignedDistribution(options)).rejects.toThrow('parent binding')
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('workflow commands expose only the sealed public identity and bind the publisher to its producer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rp-signed-command-'))
    try {
        const options = await fixture(root),
            env = {
                REVISION: expected.revision,
                VERSION: expected.version,
                EXPECTED_DIGEST: expected.digest,
                GITHUB_RUN_ID: expected.runId,
                GITHUB_RUN_ATTEMPT: String(expected.runAttempt),
                REPOSITORY_DIRECTORY: options.repository,
                RELEASE_ASSET_DIRECTORY: options.assets,
                SIGNED_DIRECTORY: options.output,
                PACKAGE_SIGNING_FINGERPRINT: fingerprint,
                PACKAGE_REPOSITORY_URL: baseUrl,
                GITHUB_OUTPUT: join(root, 'github-output'),
            }
        await signedDistributionCommand('seal', env)
        const outputs = await readFile(env.GITHUB_OUTPUT, 'utf8')
        expect(outputs).toContain(`fingerprint=${fingerprint}\nrepository_url=${baseUrl}\n`)
        const checksum = outputs.match(/^signed_bundle_sha256=([a-f0-9]{64})$/mu)?.[1]
        expect(checksum).toHaveLength(64)
        await signedDistributionCommand('restore', {
            ...env,
            SIGNED_BUNDLE_SHA256: checksum,
            RELEASE_ASSET_DIRECTORY: join(root, 'published-assets'),
        })
        expect(await readFile(join(options.repository, 'public/catalog.json'), 'utf8')).toBe('[]\n')
        await expect(signedDistributionCommand('invalid', env)).rejects.toThrow(
            'Expected seal or restore',
        )
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})
