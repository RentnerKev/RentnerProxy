import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
    NativeImageEvidence,
    OciArchitecture,
    OciDescriptor,
} from '../../../../../../.github/scripts/lib/Types/oci-layout.types.ts'
import { ociIndexType, ociManifestType } from '../../../../../../.github/scripts/lib/oci-layout.ts'

export const identity = { revision: 'a'.repeat(40), version: 'v1.0.0-beta.3' }
export const workflow = { runId: '12345', runAttempt: 2 }
export const hash = (bytes: string | Uint8Array) =>
    'sha256:' + createHash('sha256').update(bytes).digest('hex')

export async function platformFixture(
    directory: string,
    architecture: OciArchitecture,
    options: {
        readonly variant?: string
        readonly configArchitecture?: string
        readonly version?: string
        readonly revision?: string
        readonly noProvenance?: boolean
        readonly noSbom?: boolean
        readonly wrongSubject?: boolean
        readonly duplicatePlatform?: boolean
    } = {},
) {
    const layout = join(directory, 'layout')
    await mkdir(join(layout, 'blobs/sha256'), { recursive: true })
    const blob = async (value: unknown, mediaType: string): Promise<OciDescriptor> => {
        const bytes = JSON.stringify(value)
        const digest = hash(bytes)
        await writeFile(join(layout, 'blobs/sha256', digest.slice(7)), bytes)
        return { mediaType, digest, size: Buffer.byteLength(bytes) }
    }
    const config = await blob(
        {
            os: 'linux',
            architecture: options.configArchitecture ?? architecture,
            ...(options.variant ? { variant: options.variant } : {}),
            config: {
                Labels: {
                    'org.opencontainers.image.source': 'https://github.com/RentnerKev/RentnerProxy',
                    'org.opencontainers.image.revision': options.revision ?? identity.revision,
                    'org.opencontainers.image.version': options.version ?? identity.version,
                },
            },
        },
        'application/vnd.oci.image.config.v1+json',
    )
    const layer = await blob({ fixture: architecture }, 'application/vnd.oci.image.layer.v1.tar')
    const runtime = {
        ...(await blob(
            { schemaVersion: 2, mediaType: ociManifestType, config, layers: [layer] },
            ociManifestType,
        )),
        platform: {
            os: 'linux',
            architecture,
            ...(options.variant ? { variant: options.variant } : {}),
        },
    }
    const predicates = [
        ...(options.noSbom ? [] : ['https://spdx.dev/Document']),
        ...(options.noProvenance ? [] : ['https://slsa.dev/provenance/v1']),
    ]
    const statements = await Promise.all(
        predicates.map(async (predicateType) => {
            const descriptor = await blob(
                {
                    _type: 'https://in-toto.io/Statement/v0.1',
                    predicateType,
                    subject: [
                        {
                            name: 'fixture',
                            digest: {
                                sha256: options.wrongSubject
                                    ? 'f'.repeat(64)
                                    : runtime.digest.slice(7),
                            },
                        },
                    ],
                    predicate: {},
                },
                'application/vnd.in-toto+json',
            )
            return Object.assign(descriptor, {
                annotations: { 'in-toto.io/predicate-type': predicateType },
            })
        }),
    )
    const empty = { ...(await blob({}, 'application/vnd.oci.empty.v1+json')), data: 'e30=' }
    const attestation = {
        ...(await blob(
            {
                schemaVersion: 2,
                mediaType: ociManifestType,
                artifactType: 'application/vnd.docker.attestation.manifest.v1+json',
                subject: runtime,
                config: empty,
                layers: statements,
            },
            ociManifestType,
        )),
        platform: { os: 'unknown', architecture: 'unknown' },
        annotations: {
            'vnd.docker.reference.type': 'attestation-manifest',
            'vnd.docker.reference.digest': runtime.digest,
        },
    }
    const root = await blob(
        {
            schemaVersion: 2,
            mediaType: ociIndexType,
            manifests: [runtime, ...(options.duplicatePlatform ? [runtime] : []), attestation],
        },
        ociIndexType,
    )
    await writeFile(join(layout, 'oci-layout'), '{"imageLayoutVersion":"1.0.0"}')
    await writeFile(
        join(layout, 'index.json'),
        JSON.stringify({ schemaVersion: 2, manifests: [root] }),
    )
    const archive = 'fixture-archive-' + architecture
    await writeFile(join(directory, 'candidate-image.tar'), archive)
    const evidence: NativeImageEvidence = {
        schemaVersion: 1,
        ...identity,
        architecture,
        digest: root.digest,
        manifestDigest: runtime.digest,
        imageId: config.digest,
        archiveSha256: hash(archive).slice(7),
        ...workflow,
        checks: 'native-appliance-and-drain',
    }
    const nativeText = JSON.stringify(evidence)
    await writeFile(join(directory, 'native.json'), nativeText)
    await writeFile(
        join(directory, 'assessment.json'),
        JSON.stringify({
            revision: identity.revision,
            digest: root.digest,
            verdict: 'own-dependencies-approved',
            policy: 'moderate-and-above Bun; all RustSec findings',
            scope: 'rentnerproxy-locked-cargo-and-bun',
            externalRuntimePolicy: 'informational',
            assessedAt: new Date().toISOString(),
        }),
    )
    return {
        layout,
        runtime,
        root,
        config,
        layer,
        attestation,
        evidence,
        expected: {
            digest: root.digest,
            archiveSha256: evidence.archiveSha256,
            evidenceSha256: hash(nativeText).slice(7),
        },
    }
}
