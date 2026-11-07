import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
    readArtifactDirectory,
    readTriggerProof,
    validateArtifactDirectory,
    validateBuildArtifactMetadata,
} from '../../../../../.github/scripts/deploy/pr-preview/artifacts.ts'

test('preview artifact validation binds exact files, checksum, run, attempt and every source identity', async () => {
    const parent = resolve(import.meta.dir, '../../../../../tmp/preview-artifact-tests')
    await mkdir(parent, { recursive: true })
    const directory = await mkdtemp(join(parent, 'run-'))
    if (dirname(directory) !== parent) throw new Error('Unexpected artifact fixture directory.')
    const archive = Buffer.from('synthetic OCI archive: no executable content')
    const metadata = {
        artifactName: 'pr-preview-image',
        baseSha: '2'.repeat(40),
        createdAt: '2026-10-29T00:00:00.000Z',
        headRepository: 'contributor/rentnerproxy',
        headSha: '1'.repeat(40),
        ociSha256: createHash('sha256').update(archive).digest('hex'),
        platform: 'linux/amd64',
        pullRequestNumber: 42,
        repository: 'rentnerproxy/platform',
        runAttempt: 2,
        runId: 303,
        schemaVersion: 1 as const,
        testedSha: '3'.repeat(40),
        triggerRunId: 101,
    }
    const expectation = {
        artifactDirectory: directory,
        baseRef: 'main',
        baseRepository: metadata.repository,
        baseSha: metadata.baseSha,
        headRepository: metadata.headRepository,
        headSha: metadata.headSha,
        number: 42,
        runAttempt: 2,
        runId: 303,
        testedSha: metadata.testedSha,
        triggerRunId: 101,
    }
    try {
        await writeFile(join(directory, 'preview-image.tar'), archive)
        await writeFile(join(directory, 'metadata.json'), JSON.stringify(metadata))
        expect(await readArtifactDirectory(directory)).toEqual(metadata)
        await validateArtifactDirectory(expectation)
        validateBuildArtifactMetadata(metadata, metadata.repository, {
            id: 303,
            runAttempt: 2,
        } as Parameters<typeof validateBuildArtifactMetadata>[2])
        for (const change of [
            { runId: 304 },
            { runAttempt: 3 },
            { repository: 'attacker/repository' },
            { platform: 'linux/arm64' },
            { artifactName: 'other' },
        ])
            expect(() =>
                validateBuildArtifactMetadata({ ...metadata, ...change }, metadata.repository, {
                    id: 303,
                    runAttempt: 2,
                } as Parameters<typeof validateBuildArtifactMetadata>[2]),
            ).toThrow('source workflow')
        for (const change of [
            { baseSha: '4'.repeat(40) },
            { headSha: '4'.repeat(40) },
            { testedSha: '4'.repeat(40) },
            { headRepository: 'attacker/repository' },
            { repository: 'attacker/repository' },
            { pullRequestNumber: 43 },
            { triggerRunId: 102 },
            { runId: 304 },
            { runAttempt: 3 },
            { platform: 'linux/arm64' },
            { artifactName: 'other' },
        ]) {
            // eslint-disable-next-line no-await-in-loop -- each tamper case must replace the same artifact before validation
            await writeFile(
                join(directory, 'metadata.json'),
                JSON.stringify({ ...metadata, ...change }),
            )
            // eslint-disable-next-line no-await-in-loop -- validation must finish before the next artifact replacement
            await expect(validateArtifactDirectory(expectation)).rejects.toThrow('mismatch')
        }
        await writeFile(join(directory, 'metadata.json'), JSON.stringify(metadata))
        await writeFile(join(directory, 'preview-image.tar'), 'tampered')
        await expect(readArtifactDirectory(directory)).rejects.toThrow('checksum')
        await writeFile(join(directory, 'preview-image.tar'), '')
        await expect(readArtifactDirectory(directory)).rejects.toThrow('size')
        await writeFile(join(directory, 'preview-image.tar'), archive)
        await writeFile(join(directory, 'metadata.json'), 'x'.repeat(65_537))
        await expect(readArtifactDirectory(directory)).rejects.toThrow('metadata size')
        await writeFile(join(directory, 'metadata.json'), JSON.stringify(metadata))
        await writeFile(join(directory, 'unexpected.txt'), 'extra')
        await expect(readArtifactDirectory(directory)).rejects.toThrow('unexpected files')
        await rm(join(directory, 'unexpected.txt'))
        await rm(join(directory, 'metadata.json'))
        await mkdir(join(directory, 'metadata.json'))
        await expect(readArtifactDirectory(directory)).rejects.toThrow('regular files')
        expect(await readFile(join(directory, 'preview-image.tar'))).toEqual(archive)
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})

test('trigger proofs accept only two bounded regular canonical files', async () => {
    const parent = resolve(import.meta.dir, '../../../../../tmp/preview-proof-tests')
    await mkdir(parent, { recursive: true })
    const directory = await mkdtemp(join(parent, 'run-'))
    if (dirname(directory) !== parent) throw new Error('Unexpected proof fixture directory.')
    try {
        await writeFile(join(directory, 'pr-number.txt'), '42\n')
        await writeFile(join(directory, 'tested-sha.txt'), '3'.repeat(40) + '\n')
        expect(await readTriggerProof(directory)).toEqual({
            pullRequestNumber: 42,
            testedSha: '3'.repeat(40),
        })
        await writeFile(join(directory, 'pr-number.txt'), '1'.repeat(18))
        await expect(readTriggerProof(directory)).rejects.toThrow('number proof')
        await writeFile(join(directory, 'pr-number.txt'), '42\n')
        await writeFile(join(directory, 'tested-sha.txt'), 'short\n')
        await expect(readTriggerProof(directory)).rejects.toThrow('SHA proof')
        await writeFile(join(directory, 'tested-sha.txt'), '3'.repeat(40) + '\n')
        await writeFile(join(directory, 'extra'), 'unexpected')
        await expect(readTriggerProof(directory)).rejects.toThrow('invalid')
        await rm(join(directory, 'extra'))
        await rm(join(directory, 'tested-sha.txt'))
        await mkdir(join(directory, 'tested-sha.txt'))
        await expect(readTriggerProof(directory)).rejects.toThrow('invalid')
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})
