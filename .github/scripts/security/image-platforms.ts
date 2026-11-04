import { imagePlatform } from '../../../web/src/lib/ApplicationVersion/imagePlatform.ts'
import {
    ociArray,
    ociDescriptor,
    ociIndexType,
    ociManifestType,
    ociRecord,
    readOciJson,
} from '../lib/oci-layout.ts'
import type { OciArchitecture } from '../lib/Types/oci-layout.types.ts'

export function publishedImageArchitectures(raw: unknown): OciArchitecture[] {
    const image = ociRecord(raw)
    if (image.schemaVersion !== 2) throw new Error('Unsupported published image schema')
    if (
        image.mediaType === ociManifestType ||
        image.mediaType === 'application/vnd.docker.distribution.manifest.v2+json'
    )
        return ['amd64']
    if (
        image.mediaType !== ociIndexType &&
        image.mediaType !== 'application/vnd.docker.distribution.manifest.list.v2+json'
    )
        throw new Error('Unsupported published image index')
    const found = new Set<OciArchitecture>()
    for (const descriptor of ociArray(image.manifests, 16).map(ociDescriptor)) {
        if (descriptor.annotations?.['vnd.docker.reference.type'] === 'attestation-manifest')
            continue
        const platform = descriptor.platform
        const canonical =
            platform &&
            imagePlatform(
                [
                    platform.os,
                    platform.architecture,
                    ...(platform.variant ? [platform.variant] : []),
                ].join('/'),
            )
        const architecture = canonical?.slice(6) as OciArchitecture | undefined
        if (!architecture || found.has(architecture))
            throw new Error('Ambiguous or unsupported published platform')
        found.add(architecture)
    }
    if (!found.has('amd64')) throw new Error('Published appliance must retain AMD64 support')
    return found.has('arm64') ? ['amd64', 'arm64'] : ['amd64']
}

if (import.meta.main) {
    try {
        console.log(
            publishedImageArchitectures(await readOciJson(process.argv[2] ?? '')).join('\n'),
        )
    } catch {
        console.error('Published image platform validation failed.')
        process.exitCode = 1
    }
}
