import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectOciLayout, ociDescriptor } from '../../../../../.github/scripts/lib/oci-layout.ts'
import {
    assembleMultiarchImage,
    parseNativeImageEvidence,
    parsePortabilityEvidence,
    nativeUpgradeTargetVersion,
    verifyMultiarchImage,
} from '../../../../../.github/scripts/release/multiarch-image.ts'
import { hash, identity, platformFixture, workflow } from './fixtures/oci.ts'

test('multiarch publication depends on both native producers and their separate bound artifacts', async () => {
    const pipeline = Bun.YAML.parse(
        await readFile(
            new URL('../../../../../.github/workflows/build-assessed-image.yml', import.meta.url),
            'utf8',
        ),
    ) as {
        jobs: Record<
            string,
            {
                needs?: string[]
                if?: string
                permissions: Record<string, string>
                with?: Record<string, string>
                steps?: { id?: string; env?: Record<string, string> }[]
            }
        >
    }
    for (const architecture of ['amd64', 'arm64']) {
        expect(pipeline.jobs[architecture]?.with?.architecture).toBe(architecture)
        expect(pipeline.jobs[architecture]?.if).toBe(
            "github.repository == 'RentnerProxy/RentnerProxy'",
        )
        expect(pipeline.jobs[architecture]?.permissions).toEqual({ contents: 'read' })
    }
    expect(pipeline.jobs.portability?.needs).toEqual(['amd64', 'arm64'])
    const assembly = pipeline.jobs.assemble!
    expect(assembly.needs).toEqual(['amd64', 'arm64', 'portability'])
    expect(assembly.permissions).toEqual({ contents: 'read' })
    const environment = assembly.steps?.find((step) => step.id === 'assemble')?.env
    for (const architecture of ['amd64', 'arm64']) {
        expect(environment?.[architecture.toUpperCase() + '_DIGEST']).toBe(
            '${{ needs.' + architecture + '.outputs.digest }}',
        )
        expect(environment?.[architecture.toUpperCase() + '_EVIDENCE_SHA256']).toBe(
            '${{ needs.' + architecture + '.outputs.evidence_sha256 }}',
        )
    }
    const review = await readFile(
        new URL('../../../../../.github/workflows/multiarch-candidate.yml', import.meta.url),
        'utf8',
    )
    expect(review).not.toContain('packages: write')
    expect(review).not.toContain('publish-assessed-image.yml\n')
})

describe('assessed native OCI image assembly', () => {
    test('embedded OCI data must match the separately authenticated blob digest and size', () => {
        const descriptor = {
            mediaType: 'application/vnd.oci.empty.v1+json',
            digest: hash('{}'),
            size: 2,
            data: 'e30=',
        }
        expect(ociDescriptor(descriptor).data).toBe('e30=')
        expect(() => ociDescriptor({ ...descriptor, data: 'e10=' })).toThrow(
            'digest or size mismatch',
        )
        expect(() =>
            ociDescriptor({ ...descriptor, urls: ['https://external.invalid/blob'] }),
        ).toThrow('External')
    })
    test.each([
        'missing',
        'blocked',
        'stale',
        'archive',
        'native-checksum',
        'portability-checksum',
    ])('never assembles a partially trusted platform set: %s', async (scenario) => {
        const directory = await mkdtemp(join(tmpdir(), 'rp-rejected-'))
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
            const approvalFile = join(directory, 'arm64/assessment.json')
            if (scenario === 'missing') await rm(approvalFile)
            if (scenario === 'blocked' || scenario === 'stale') {
                const approval = JSON.parse(await readFile(approvalFile, 'utf8'))
                if (scenario === 'blocked') approval.verdict = 'blocked'
                else approval.assessedAt = '2000-01-01T00:00:00Z'
                await writeFile(approvalFile, JSON.stringify(approval))
            }
            if (scenario === 'archive')
                await writeFile(join(directory, 'arm64/candidate-image.tar'), 'changed')
            if (scenario === 'native-checksum')
                await writeFile(join(directory, 'arm64/native.json'), '{}')
            await expect(
                assembleMultiarchImage({
                    directory,
                    output: join(directory, 'combined'),
                    identity,
                    ...workflow,
                    expected: { amd64: amd64.expected, arm64: arm64.expected },
                    portabilitySha256: hash(
                        scenario === 'portability-checksum' ? 'changed' : portability,
                    ).slice(7),
                }),
            ).rejects.toThrow()
            expect(await Bun.file(join(directory, 'combined/index.json')).exists()).toBe(false)
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })
    test('cross-architecture backup proof rejects legacy formats and missing native completion', () => {
        const proof = {
            schemaVersion: 1,
            ...identity,
            sourceManifest: hash('source'),
            targetManifest: hash('target'),
            backupVersion: 4,
            checks: 'amd64-backup-to-native-arm64',
            nativeUpgradeSources: [],
        }
        expect(parsePortabilityEvidence(proof, identity).backupVersion).toBe(4)
        for (const change of [
            { backupVersion: 3 },
            { checks: 'emulated' },
            { revision: 'b'.repeat(40) },
            { nativeUpgradeSources: ['beta.1'] },
        ])
            expect(() => parsePortabilityEvidence({ ...proof, ...change }, identity)).toThrow()
    })
    test('release evidence accepts only distinct native sources strictly older than the actual candidate version', () => {
        const candidate = { ...identity, version: 'v1.0.0-beta.4' }
        const proof = {
            schemaVersion: 1,
            ...candidate,
            sourceManifest: hash('source'),
            targetManifest: hash('target'),
            backupVersion: 4,
            checks: 'amd64-backup-to-native-arm64',
            nativeUpgradeSources: ['v1.0.0-beta.3'],
        }
        expect(parsePortabilityEvidence(proof, candidate).nativeUpgradeSources).toEqual([
            'v1.0.0-beta.3',
        ])
        for (const sources of [
            ['v1.0.0-beta.4'],
            ['v1.0.0-beta.5'],
            ['v1.0.0-beta.3', 'v1.0.0-beta.3'],
        ])
            expect(() =>
                parsePortabilityEvidence({ ...proof, nativeUpgradeSources: sources }, candidate),
            ).toThrow()
        expect(nativeUpgradeTargetVersion(candidate.version)).toBe('1.0.0-beta.4')
        expect(nativeUpgradeTargetVersion('dev-' + 'a'.repeat(12))).toBe('0.0.0')
        expect(nativeUpgradeTargetVersion('dev-' + 'a'.repeat(40))).toBe('0.0.0')
        expect(nativeUpgradeTargetVersion('v1.0.0-alpha.9')).toBeNull()
        expect(() => nativeUpgradeTargetVersion('unbound')).toThrow()
        const alpha = { ...candidate, version: 'v1.0.0-alpha.9' }
        expect(() =>
            parsePortabilityEvidence({ ...proof, version: alpha.version }, alpha),
        ).toThrow()
    })
    for (const architecture of ['amd64', 'arm64'] as const) {
        test(`verifies ${architecture} runtime/config identity and retained attestations`, async () => {
            const directory = await mkdtemp(join(tmpdir(), 'rp-oci-'))
            try {
                const source = await platformFixture(
                    directory,
                    architecture,
                    architecture === 'arm64' ? { variant: 'v8' } : {},
                )
                const result = await inspectOciLayout(source.layout, identity, [architecture])
                expect(result.digest).toBe(source.root.digest)
                expect(result.images.get(architecture)?.digest).toBe(source.runtime.digest)
                expect(result.imageIds.get(architecture)).toBe(source.config.digest)
                expect(result.blobs.has(source.attestation.digest)).toBe(true)
            } finally {
                await rm(directory, { recursive: true, force: true })
            }
        })
    }
    for (const options of [
        { configArchitecture: 'arm64' },
        { version: 'v1.0.0-beta.2' },
        { revision: 'b'.repeat(40) },
        { noProvenance: true },
        { noSbom: true },
        { wrongSubject: true },
        { duplicatePlatform: true },
        { variant: 'v9' },
    ]) {
        test(`rejects mismatched or incomplete OCI candidate ${JSON.stringify(options)}`, async () => {
            const directory = await mkdtemp(join(tmpdir(), 'rp-oci-'))
            try {
                const source = await platformFixture(directory, 'amd64', options)
                await expect(inspectOciLayout(source.layout, identity, ['amd64'])).rejects.toThrow()
            } finally {
                await rm(directory, { recursive: true, force: true })
            }
        })
    }
    test('rejects content-addressed blob tampering and an incomplete platform set', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'rp-oci-'))
        try {
            const source = await platformFixture(directory, 'amd64')
            await expect(
                inspectOciLayout(source.layout, identity, ['amd64', 'arm64']),
            ).rejects.toThrow('Incomplete')
            await writeFile(
                join(source.layout, 'blobs/sha256', source.layer.digest.slice(7)),
                'tampered',
            )
            await expect(inspectOciLayout(source.layout, identity, ['amd64'])).rejects.toThrow()
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })
    test('assembles exact native-tested artifacts and preserves every SBOM/provenance blob', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'rp-multiarch-'))
        try {
            const amd64 = await platformFixture(join(directory, 'amd64'), 'amd64')
            const arm64 = await platformFixture(join(directory, 'arm64'), 'arm64', {
                variant: 'v8',
            })
            const portability = {
                schemaVersion: 1,
                ...identity,
                sourceManifest: amd64.runtime.digest,
                targetManifest: arm64.runtime.digest,
                backupVersion: 4,
                checks: 'amd64-backup-to-native-arm64',
                nativeUpgradeSources: [],
            }
            const serialized = JSON.stringify(portability)
            await writeFile(join(directory, 'portability.json'), serialized)
            const evidence = await assembleMultiarchImage({
                directory,
                output: join(directory, 'combined'),
                identity,
                ...workflow,
                expected: { amd64: amd64.expected, arm64: arm64.expected },
                portabilitySha256: hash(serialized).slice(7),
            })
            expect(evidence.native.map((item) => item.architecture)).toEqual(['amd64', 'arm64'])
            const result = await inspectOciLayout(join(directory, 'combined'), identity, [
                'amd64',
                'arm64',
            ])
            expect(result.images.get('amd64')?.digest).toBe(amd64.runtime.digest)
            expect(result.images.get('arm64')?.digest).toBe(arm64.runtime.digest)
            for (const fixture of [amd64, arm64]) {
                expect(
                    // oxlint-disable-next-line no-await-in-loop -- Compare each retained artifact to its producing platform.
                    await readFile(
                        join(
                            directory,
                            'combined/blobs/sha256',
                            fixture.attestation.digest.slice(7),
                        ),
                    ),
                ).toEqual(
                    // oxlint-disable-next-line no-await-in-loop -- Compare each retained artifact to its producing platform.
                    await readFile(
                        join(fixture.layout, 'blobs/sha256', fixture.attestation.digest.slice(7)),
                    ),
                )
            }
            await expect(
                verifyMultiarchImage(
                    join(directory, 'combined'),
                    { ...evidence, native: [evidence.native[1], evidence.native[0]] },
                    identity,
                    workflow.runId,
                    workflow.runAttempt,
                ),
            ).rejects.toThrow()
            await expect(
                verifyMultiarchImage(
                    join(directory, 'combined'),
                    {
                        ...evidence,
                        portability: { ...portability, targetManifest: amd64.runtime.digest },
                    },
                    identity,
                    workflow.runId,
                    workflow.runAttempt,
                ),
            ).rejects.toThrow('different images')
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })
    test('native evidence rejects emulated/partial, foreign-version and foreign-run claims', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'rp-oci-'))
        try {
            const source = await platformFixture(directory, 'arm64')
            for (const change of [
                { checks: 'build-only' },
                { version: 'wrong' },
                { revision: 'b'.repeat(40) },
                { architecture: 'amd64' },
                { runId: '987' },
                { runAttempt: 3 },
                { imageId: 'invalid' },
                { archiveSha256: '' },
            ])
                expect(() =>
                    parseNativeImageEvidence(
                        { ...source.evidence, ...change },
                        identity,
                        'arm64',
                        workflow.runId,
                        workflow.runAttempt,
                    ),
                ).toThrow()
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })
})
