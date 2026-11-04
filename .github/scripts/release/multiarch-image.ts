// oxlint-disable no-await-in-loop -- Verify each source and copy only authenticated, content-addressed blobs.
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { appendFile, copyFile, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
    hashOciFile,
    inspectOciLayout,
    ociDigest,
    ociIndexType,
    ociRecord,
    ociText,
    readOciJson,
} from '../lib/oci-layout.ts'
import { evaluateApprovedAssessment } from '../security/dependency-policy.ts'
import type {
    NativeImageEvidence,
    OciArchitecture,
    OciImageIdentity,
} from '../lib/Types/oci-layout.types.ts'
import type { MultiarchImageEvidence, PortabilityEvidence } from './Types/multiarch-image.types.ts'

export function parseNativeImageEvidence(
    raw: unknown,
    identity: OciImageIdentity,
    architecture: OciArchitecture,
    runId: string,
    runAttempt: number,
): NativeImageEvidence {
    const evidence = ociRecord(raw)
    if (
        evidence.schemaVersion !== 1 ||
        evidence.architecture !== architecture ||
        evidence.revision !== identity.revision ||
        evidence.version !== identity.version ||
        evidence.runId !== runId ||
        evidence.checks !== 'native-appliance-and-drain' ||
        typeof evidence.runAttempt !== 'number' ||
        !Number.isSafeInteger(evidence.runAttempt) ||
        evidence.runAttempt < 1 ||
        evidence.runAttempt > runAttempt ||
        typeof evidence.archiveSha256 !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(evidence.archiveSha256)
    )
        throw new Error('Native image evidence does not match the exact candidate and run')
    return {
        schemaVersion: 1,
        architecture,
        revision: identity.revision,
        version: identity.version,
        digest: ociDigest(evidence.digest),
        manifestDigest: ociDigest(evidence.manifestDigest),
        imageId: ociDigest(evidence.imageId),
        archiveSha256: evidence.archiveSha256,
        runId,
        runAttempt: evidence.runAttempt,
        checks: 'native-appliance-and-drain',
    }
}

export function parsePortabilityEvidence(
    raw: unknown,
    identity: OciImageIdentity,
): PortabilityEvidence {
    const evidence = ociRecord(raw)
    if (
        evidence.schemaVersion !== 1 ||
        evidence.revision !== identity.revision ||
        evidence.version !== identity.version ||
        evidence.backupVersion !== 4 ||
        evidence.checks !== 'amd64-backup-to-native-arm64' ||
        !Array.isArray(evidence.nativeUpgradeSources) ||
        evidence.nativeUpgradeSources.length > 2 ||
        !evidence.nativeUpgradeSources.every(
            (version) =>
                typeof version === 'string' &&
                /^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u.test(version),
        )
    )
        throw new Error('Cross-architecture backup evidence is incomplete')
    return {
        schemaVersion: 1,
        revision: identity.revision,
        version: identity.version,
        sourceManifest: ociDigest(evidence.sourceManifest),
        targetManifest: ociDigest(evidence.targetManifest),
        backupVersion: 4,
        checks: 'amd64-backup-to-native-arm64',
        nativeUpgradeSources: evidence.nativeUpgradeSources as string[],
    }
}

export async function verifyMultiarchImage(
    layoutDirectory: string,
    rawEvidence: unknown,
    identity: OciImageIdentity,
    runId: string,
    runAttempt: number,
): Promise<MultiarchImageEvidence> {
    const evidence = ociRecord(rawEvidence)
    if (
        evidence.schemaVersion !== 1 ||
        evidence.revision !== identity.revision ||
        evidence.version !== identity.version ||
        evidence.runId !== runId ||
        !Array.isArray(evidence.native) ||
        evidence.native.length !== 2
    )
        throw new Error('Invalid assessed multi-architecture evidence')
    const image = await inspectOciLayout(layoutDirectory, identity, ['amd64', 'arm64'])
    if (evidence.digest !== image.digest)
        throw new Error('Multi-architecture index digest mismatch')
    const nativeEntries = evidence.native
    const native = (['amd64', 'arm64'] as const).map((architecture, index) => {
        const entry = parseNativeImageEvidence(
            nativeEntries[index],
            identity,
            architecture,
            runId,
            runAttempt,
        )
        if (
            entry.manifestDigest !== image.images.get(architecture)?.digest ||
            entry.imageId !== image.imageIds.get(architecture)
        )
            throw new Error('Native tests belong to a different platform image')
        return entry
    })
    const portability = parsePortabilityEvidence(evidence.portability, identity)
    if (
        portability.sourceManifest !== native[0]?.manifestDigest ||
        portability.targetManifest !== native[1]?.manifestDigest
    )
        throw new Error('Backup portability was tested against different images')
    return {
        schemaVersion: 1,
        revision: identity.revision,
        version: identity.version,
        digest: image.digest,
        runId,
        native,
        portability,
    }
}

export async function assembleMultiarchImage(input: {
    readonly directory: string
    readonly output: string
    readonly identity: OciImageIdentity
    readonly runId: string
    readonly runAttempt: number
    readonly expected: Readonly<
        Record<
            OciArchitecture,
            {
                readonly digest: string
                readonly archiveSha256: string
                readonly evidenceSha256: string
            }
        >
    >
    readonly portabilitySha256: string
}): Promise<MultiarchImageEvidence> {
    const native: NativeImageEvidence[] = []
    const descriptors = []
    const sourceBlobs = new Map<string, { path: string; size: number }>()
    for (const architecture of ['amd64', 'arm64'] as const) {
        const source = join(input.directory, architecture)
        const expected = input.expected[architecture]
        if (
            (await hashOciFile(join(source, 'candidate-image.tar'))) !==
                'sha256:' + expected.archiveSha256 ||
            (await hashOciFile(join(source, 'native.json'))) !== 'sha256:' + expected.evidenceSha256
        )
            throw new Error('Platform producer artifact checksum mismatch')
        const proof = parseNativeImageEvidence(
            await readOciJson(join(source, 'native.json')),
            input.identity,
            architecture,
            input.runId,
            input.runAttempt,
        )
        const image = await inspectOciLayout(join(source, 'layout'), input.identity, [architecture])
        if (
            image.digest !== expected.digest ||
            proof.digest !== image.digest ||
            proof.archiveSha256 !== expected.archiveSha256 ||
            proof.manifestDigest !== image.images.get(architecture)?.digest ||
            proof.imageId !== image.imageIds.get(architecture)
        )
            throw new Error('Native platform artifact identity mismatch')
        evaluateApprovedAssessment(await readOciJson(join(source, 'assessment.json')), {
            revision: input.identity.revision,
            digest: image.digest,
        })
        native.push(proof)
        descriptors.push(...image.descriptors)
        for (const [digest, blob] of image.blobs) {
            if (sourceBlobs.has(digest) && sourceBlobs.get(digest)?.size !== blob.size)
                throw new Error('Conflicting content-addressed image blob')
            sourceBlobs.set(digest, blob)
        }
    }
    const portabilityFile = join(input.directory, 'portability.json')
    if ((await hashOciFile(portabilityFile)) !== 'sha256:' + input.portabilitySha256)
        throw new Error('Portability producer artifact checksum mismatch')
    const portability = parsePortabilityEvidence(await readOciJson(portabilityFile), input.identity)
    await mkdir(input.output)
    await mkdir(join(input.output, 'blobs/sha256'), { recursive: true })
    for (const [digest, blob] of sourceBlobs)
        await copyFile(
            blob.path,
            join(input.output, 'blobs/sha256', digest.slice(7)),
            constants.COPYFILE_EXCL,
        )
    const index = JSON.stringify({
        schemaVersion: 2,
        mediaType: ociIndexType,
        manifests: descriptors,
    })
    const digest = 'sha256:' + createHash('sha256').update(index).digest('hex')
    await writeFile(join(input.output, 'blobs/sha256', digest.slice(7)), index, { flag: 'wx' })
    await writeFile(join(input.output, 'oci-layout'), '{"imageLayoutVersion":"1.0.0"}\n', {
        flag: 'wx',
    })
    await writeFile(
        join(input.output, 'index.json'),
        JSON.stringify({
            schemaVersion: 2,
            manifests: [
                {
                    mediaType: ociIndexType,
                    digest,
                    size: Buffer.byteLength(index),
                    annotations: { 'org.opencontainers.image.ref.name': 'candidate' },
                },
            ],
        }) + '\n',
        { flag: 'wx' },
    )
    return verifyMultiarchImage(
        input.output,
        { schemaVersion: 1, ...input.identity, digest, runId: input.runId, native, portability },
        input.identity,
        input.runId,
        input.runAttempt,
    )
}

if (import.meta.main) {
    try {
        const env = process.env
        const identity = { revision: ociText(env.REVISION), version: ociText(env.VERSION) }
        const runId = ociText(env.GITHUB_RUN_ID)
        const runAttempt = Number(env.GITHUB_RUN_ATTEMPT)
        if (!/^[1-9][0-9]*$/u.test(runId) || !Number.isSafeInteger(runAttempt) || runAttempt < 1)
            throw new Error('Invalid workflow run identity')
        const directory = resolve(ociText(env.IMAGE_DIRECTORY))
        if (process.argv[2] === 'assemble') {
            const expected = Object.fromEntries(
                (['amd64', 'arm64'] as const).map((architecture) => [
                    architecture,
                    {
                        digest: ociDigest(env[architecture.toUpperCase() + '_DIGEST']),
                        archiveSha256: ociText(env[architecture.toUpperCase() + '_ARCHIVE_SHA256']),
                        evidenceSha256: ociText(
                            env[architecture.toUpperCase() + '_EVIDENCE_SHA256'],
                        ),
                    },
                ]),
            ) as Parameters<typeof assembleMultiarchImage>[0]['expected']
            const evidence = await assembleMultiarchImage({
                directory,
                output: resolve(ociText(env.IMAGE_OUTPUT)),
                identity,
                runId,
                runAttempt,
                expected,
                portabilitySha256: ociText(env.PORTABILITY_SHA256),
            })
            await writeFile(join(directory, 'evidence.json'), JSON.stringify(evidence) + '\n', {
                flag: 'wx',
            })
            if (env.GITHUB_OUTPUT)
                await appendFile(
                    env.GITHUB_OUTPUT,
                    `digest=${evidence.digest}\nplatforms=linux/amd64,linux/arm64\nevidence_sha256=${(await hashOciFile(join(directory, 'evidence.json'))).slice(7)}\n`,
                )
        } else if (process.argv[2] === 'verify') {
            const evidence = await verifyMultiarchImage(
                directory,
                await readOciJson(ociText(env.EVIDENCE_FILE)),
                identity,
                runId,
                runAttempt,
            )
            if (env.EXPECTED_DIGEST !== evidence.digest)
                throw new Error('Unexpected publication index')
            if (env.PLATFORM_REPORT_DIRECTORY) {
                for (const architecture of ['amd64', 'arm64'])
                    evaluateApprovedAssessment(
                        await readOciJson(
                            join(env.PLATFORM_REPORT_DIRECTORY, architecture, 'assessment.json'),
                        ),
                        { revision: identity.revision, digest: evidence.digest },
                    )
            }
        } else throw new Error('Expected assemble or verify')
    } catch {
        console.error('Assessed multi-architecture image validation failed.')
        process.exitCode = 1
    }
}
