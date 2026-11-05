// oxlint-disable no-await-in-loop -- Replace the same controlled asset between rejection scenarios.
import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { distributionPayload } from '../../../../../.github/scripts/distribution/payload.ts'
import { parseDistributionRelease } from '../../../../../.github/scripts/distribution/release.ts'

const release = parseDistributionRelease({
    schemaVersion: 1,
    revision: 'a'.repeat(40),
    version: 'v1.0.0-beta.3',
    digest: 'sha256:' + 'b'.repeat(64),
    platform: 'linux/amd64',
    packageRevision: 1,
})
test('release payload generation refuses binary/oversized source assets and ambiguous Quadlet substitutions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rp-source-assets-'))
    const directory = join(root, 'packaging/linux')
    try {
        await mkdir(directory, { recursive: true })
        await Promise.all([
            writeFile(join(directory, 'rentnerproxy'), '#!/bin/bash\n'),
            writeFile(join(directory, 'rentnerproxy.volume'), '[Volume]\nVolumeName=fixture\n'),
            writeFile(
                join(directory, 'appliance.env.example'),
                'PUBLIC_ORIGIN=https://fixture.invalid\n',
            ),
            writeFile(join(root, 'LICENSE'), 'MIT fixture\n'),
        ])
        const template = '[Container]\nImage=@@IMAGE@@\nPodmanArgs=--platform=@@PLATFORM@@\n'
        await writeFile(join(directory, 'rentnerproxy.container.in'), template)
        expect(await distributionPayload(root, release)).toHaveLength(9)
        for (const content of ['', 'binary\0asset', 'x'.repeat(1024 * 1024 + 1)]) {
            await writeFile(join(directory, 'rentnerproxy'), content)
            await expect(distributionPayload(root, release)).rejects.toThrow('asset')
        }
        await writeFile(join(directory, 'rentnerproxy'), '#!/bin/bash\n')
        for (const content of [
            template + '@@IMAGE@@',
            template.replace('@@PLATFORM@@', 'latest'),
            template + '@@UNKNOWN@@',
        ]) {
            await writeFile(join(directory, 'rentnerproxy.container.in'), content)
            await expect(distributionPayload(root, release)).rejects.toThrow()
        }
        await rm(directory, { recursive: true })
        await writeFile(directory, 'a file cannot be a source directory')
        await expect(distributionPayload(root, release)).rejects.toThrow('directory')
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})
