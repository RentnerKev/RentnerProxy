// oxlint-disable no-await-in-loop -- Traverse and authenticate each bounded OCI descriptor before using it.
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { imagePlatform } from '../../../web/src/lib/ApplicationVersion/imagePlatform.ts'
import type {
    OciArchitecture,
    OciDescriptor,
    OciImageIdentity,
    OciLayoutImage,
} from './Types/oci-layout.types.ts'

export const ociIndexType = 'application/vnd.oci.image.index.v1+json'
export const ociManifestType = 'application/vnd.oci.image.manifest.v1+json'
const digestPattern = /^sha256:[a-f0-9]{64}$/u

export function ociRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Invalid OCI metadata object')
    return value as Record<string, unknown>
}

export function ociArray(value: unknown, maximum = 128): unknown[] {
    if (!Array.isArray(value) || value.length > maximum) throw new Error('Invalid OCI array')
    return value
}

export function ociText(value: unknown): string {
    if (typeof value !== 'string' || !value || value.length > 4096 || /[\r\n\0]/u.test(value))
        throw new Error('Invalid OCI metadata string')
    return value
}

export function ociDigest(value: unknown): string {
    const text = ociText(value)
    if (!digestPattern.test(text)) throw new Error('Invalid OCI digest')
    return text
}

export function ociDescriptor(value: unknown): OciDescriptor {
    const descriptor = ociRecord(value)
    const mediaType = ociText(descriptor.mediaType)
    const digest = ociDigest(descriptor.digest)
    const size = descriptor.size
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0 || size > 8 * 1024 ** 3)
        throw new Error('Invalid OCI descriptor size')
    if (descriptor.urls !== undefined) throw new Error('External OCI descriptors are not supported')
    if (descriptor.data !== undefined) {
        if (
            typeof descriptor.data !== 'string' ||
            size > 1024 * 1024 ||
            descriptor.data.length > 1_398_104
        )
            throw new Error('Invalid embedded OCI data')
        const embedded = Buffer.from(descriptor.data, 'base64')
        if (
            embedded.length !== size ||
            embedded.toString('base64') !== descriptor.data ||
            'sha256:' + createHash('sha256').update(embedded).digest('hex') !== digest
        )
            throw new Error('Embedded OCI data digest or size mismatch')
    }
    let platform: OciDescriptor['platform']
    if (descriptor.platform !== undefined) {
        const source = ociRecord(descriptor.platform)
        platform = {
            os: ociText(source.os),
            architecture: ociText(source.architecture),
            ...(source.variant === undefined ? {} : { variant: ociText(source.variant) }),
        }
        if (source['os.features'] !== undefined || source['os.version'] !== undefined)
            throw new Error('Unsupported OCI platform requirements')
    }
    let annotations: Record<string, string> | undefined
    if (descriptor.annotations !== undefined) {
        const entries = Object.entries(ociRecord(descriptor.annotations))
        if (entries.length > 32) throw new Error('Excessive OCI annotations')
        annotations = Object.fromEntries(
            entries.map(([key, entry]) => [ociText(key), ociText(entry)]),
        )
    }
    return {
        mediaType,
        digest,
        size,
        ...(descriptor.data === undefined ? {} : { data: descriptor.data as string }),
        ...(platform ? { platform } : {}),
        ...(annotations ? { annotations } : {}),
        ...(descriptor.artifactType === undefined
            ? {}
            : { artifactType: ociText(descriptor.artifactType) }),
    }
}

export async function hashOciFile(path: string, expectedSize?: number): Promise<string> {
    const info = await lstat(path)
    if (
        !info.isFile() ||
        info.size > 8 * 1024 ** 3 ||
        (expectedSize !== undefined && info.size !== expectedSize)
    )
        throw new Error('Invalid OCI blob file or size')
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(path)) hash.update(chunk)
    return 'sha256:' + hash.digest('hex')
}

export async function readOciJson(path: string, maximum = 1024 * 1024): Promise<unknown> {
    const info = await lstat(path)
    if (!info.isFile() || info.size < 1 || info.size > maximum)
        throw new Error('Invalid OCI JSON file')
    return JSON.parse(await readFile(path, 'utf8')) as unknown
}

function indexDescriptors(value: unknown, wrapper = false): OciDescriptor[] {
    const index = ociRecord(value)
    if (
        index.schemaVersion !== 2 ||
        (index.mediaType !== ociIndexType && !(wrapper && index.mediaType === undefined))
    )
        throw new Error('Expected an OCI image index')
    return ociArray(index.manifests, 8).map(ociDescriptor)
}

export async function inspectOciLayout(
    directory: string,
    identity: OciImageIdentity,
    architectures: readonly OciArchitecture[],
): Promise<OciLayoutImage> {
    if (!/^[a-f0-9]{40}$/u.test(identity.revision)) throw new Error('Invalid image revision')
    ociText(identity.version)
    for (const path of [directory, join(directory, 'blobs'), join(directory, 'blobs/sha256')])
        if (!(await lstat(path)).isDirectory()) throw new Error('Invalid OCI layout directory')
    if (ociRecord(await readOciJson(join(directory, 'oci-layout'))).imageLayoutVersion !== '1.0.0')
        throw new Error('Unsupported OCI layout version')
    const roots = indexDescriptors(await readOciJson(join(directory, 'index.json')), true)
    if (roots.length !== 1 || roots[0]?.mediaType !== ociIndexType)
        throw new Error('Expected one complete attested OCI index')
    const root = roots[0]
    const blobs = new Map<string, { path: string; size: number }>()
    const verifyBlob = async (descriptor: OciDescriptor): Promise<string> => {
        const existing = blobs.get(descriptor.digest)
        if (existing) {
            if (existing.size !== descriptor.size) throw new Error('Conflicting OCI blob size')
            return existing.path
        }
        const path = join(directory, 'blobs/sha256', descriptor.digest.slice(7))
        if ((await hashOciFile(path, descriptor.size)) !== descriptor.digest)
            throw new Error('OCI blob digest mismatch')
        blobs.set(descriptor.digest, { path, size: descriptor.size })
        if (blobs.size > 1024) throw new Error('Excessive OCI blob graph')
        return path
    }
    const descriptors = indexDescriptors(await readOciJson(await verifyBlob(root)))
    const images = new Map<OciArchitecture, OciDescriptor>()
    const imageIds = new Map<OciArchitecture, string>()
    const attestations: OciDescriptor[] = []
    for (const descriptor of descriptors) {
        if (descriptor.mediaType !== ociManifestType)
            throw new Error('Unsupported OCI child manifest')
        if (
            descriptor.annotations?.['vnd.docker.reference.type'] === 'attestation-manifest' ||
            descriptor.artifactType === 'application/vnd.docker.attestation.manifest.v1+json'
        ) {
            attestations.push(descriptor)
            continue
        }
        const platform = descriptor.platform
        const normalized =
            platform &&
            imagePlatform(
                [
                    platform.os,
                    platform.architecture,
                    ...(platform.variant ? [platform.variant] : []),
                ].join('/'),
            )
        const architecture = normalized?.slice(6) as OciArchitecture | undefined
        if (!architecture || !architectures.includes(architecture) || images.has(architecture))
            throw new Error('Missing, duplicate or unexpected OCI platform')
        images.set(architecture, descriptor)
    }
    if (images.size !== architectures.length) throw new Error('Incomplete OCI platform set')
    for (const [architecture, descriptor] of images) {
        const manifest = ociRecord(await readOciJson(await verifyBlob(descriptor)))
        if (
            manifest.schemaVersion !== 2 ||
            manifest.mediaType !== ociManifestType ||
            manifest.artifactType !== undefined
        )
            throw new Error('Invalid runnable OCI manifest')
        const configDescriptor = ociDescriptor(manifest.config)
        if (configDescriptor.mediaType !== 'application/vnd.oci.image.config.v1+json')
            throw new Error('Unsupported OCI image configuration')
        const config = ociRecord(await readOciJson(await verifyBlob(configDescriptor)))
        const actualPlatform = imagePlatform(
            [
                ociText(config.os),
                ociText(config.architecture),
                ...(config.variant === undefined ? [] : [ociText(config.variant)]),
            ].join('/'),
        )
        if (actualPlatform !== 'linux/' + architecture)
            throw new Error('OCI image configuration platform mismatch')
        imageIds.set(architecture, configDescriptor.digest)
        const labels = ociRecord(ociRecord(config.config).Labels)
        if (
            labels['org.opencontainers.image.revision'] !== identity.revision ||
            labels['org.opencontainers.image.version'] !== identity.version ||
            labels['org.opencontainers.image.source'] !==
                'https://github.com/RentnerKev/RentnerProxy'
        )
            throw new Error('OCI image revision or version mismatch')
        const layers = ociArray(manifest.layers, 256).map(ociDescriptor)
        if (!layers.length) throw new Error('Runnable OCI image has no layers')
        for (const layer of layers) {
            if (
                !/^application\/vnd\.oci\.image\.layer\.v1\.tar(?:\+gzip|\+zstd)?$/u.test(
                    layer.mediaType,
                )
            )
                throw new Error('Unsupported OCI image layer')
            await verifyBlob(layer)
        }
        const predicates = new Set<string>()
        const related = attestations.filter(
            (attestation) =>
                attestation.annotations?.['vnd.docker.reference.digest'] === descriptor.digest,
        )
        if (related.length !== 1) throw new Error('Missing or ambiguous platform attestation')
        for (const attestation of related) {
            const document = ociRecord(await readOciJson(await verifyBlob(attestation)))
            if (document.schemaVersion !== 2 || document.mediaType !== ociManifestType)
                throw new Error('Invalid OCI attestation manifest')
            if (
                document.subject !== undefined &&
                ociDescriptor(document.subject).digest !== descriptor.digest
            )
                throw new Error('OCI attestation subject mismatch')
            await verifyBlob(ociDescriptor(document.config))
            for (const layer of ociArray(document.layers, 16).map(ociDescriptor)) {
                if (layer.mediaType !== 'application/vnd.in-toto+json')
                    throw new Error('Unsupported OCI attestation layer')
                const statement = ociRecord(
                    await readOciJson(await verifyBlob(layer), 64 * 1024 * 1024),
                )
                const predicate = ociText(statement.predicateType)
                if (layer.annotations?.['in-toto.io/predicate-type'] !== predicate)
                    throw new Error('OCI attestation predicate mismatch')
                const subjects = ociArray(statement.subject, 16).map(ociRecord)
                if (
                    !subjects.some(
                        (subject) =>
                            ociRecord(subject.digest).sha256 === descriptor.digest.slice(7),
                    )
                )
                    throw new Error('OCI attestation does not bind the platform image')
                predicates.add(predicate)
            }
        }
        if (
            !predicates.has('https://spdx.dev/Document') ||
            ![...predicates].some((predicate) =>
                /^https:\/\/slsa\.dev\/provenance\/(?:v0\.2|v1)$/u.test(predicate),
            )
        )
            throw new Error('Platform SBOM and provenance are required')
    }
    if (attestations.length !== images.size) throw new Error('Unbound OCI attestation')
    return { digest: root.digest, descriptors, images, imageIds, blobs }
}
