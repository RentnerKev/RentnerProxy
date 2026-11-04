import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { appendFile, lstat, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { sharedSmokeImage } from '../../../scripts/smoke/images.ts'
import { smokeRunScope, SMOKE_RUN_LABEL } from '../../../scripts/smoke/resources.ts'
import type { Http3Command } from '../../../scripts/smoke/http3/Types/client.types.ts'

const sha256 = /^[a-f0-9]{64}$/u
const digest = /^sha256:[a-f0-9]{64}$/u
const identityKeys = [
    'schemaVersion',
    'revision',
    'scope',
    'kind',
    'platform',
    'manifestDigest',
    'imageId',
    'archiveSha256',
]

function requireValue(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message)
}

function record(value: unknown): Record<string, unknown> {
    requireValue(
        value !== null && typeof value === 'object' && !Array.isArray(value),
        'Invalid image metadata object',
    )
    return value as Record<string, unknown>
}

function boundedJson(value: string): Record<string, unknown> {
    requireValue(Buffer.byteLength(value) <= 65_536, 'Image metadata exceeds the size limit')
    try {
        return record(JSON.parse(value))
    } catch {
        throw new Error('Invalid image metadata JSON')
    }
}

async function hashFile(path: string, maximumSize?: number): Promise<string> {
    const info = await lstat(path)
    requireValue(info.isFile() && info.size > 0, 'Image artifact must be a nonempty regular file')
    requireValue(
        maximumSize === undefined || info.size <= maximumSize,
        'Image metadata exceeds the size limit',
    )
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(path)) hash.update(chunk)
    return hash.digest('hex')
}

const execute: Http3Command = async (args) => {
    const child = Bun.spawn(args, { stdout: 'pipe', stderr: 'ignore', stdin: 'ignore' })
    // Commands only return inspection JSON or a revision; never print tool diagnostics.
    const chunks: Uint8Array[] = []
    let size = 0
    for await (const chunk of child.stdout) {
        size += chunk.byteLength
        if (size > 65_536) {
            child.kill()
            await child.exited
            throw new Error('Image command output exceeds the size limit')
        }
        chunks.push(chunk)
    }
    requireValue((await child.exited) === 0, 'Image artifact command failed')
    return Buffer.concat(chunks).toString('utf8')
}

export async function runtimeImageArtifact(action: string, command: Http3Command = execute) {
    requireValue(action === 'pack' || action === 'load', 'Expected pack or load action')
    const platform = process.env.RUNTIME_IMAGE_PLATFORM ?? 'linux/amd64'
    requireValue(
        platform === 'linux/amd64' || platform === 'linux/arm64',
        'Unsupported runtime image platform',
    )
    const architecture = platform.slice('linux/'.length)
    const kind = process.env.RUNTIME_IMAGE_KIND
    requireValue(
        kind === 'appliance' || kind === 'http3-client' || kind === 'proxy-runtime',
        'Invalid runtime image kind',
    )
    requireValue(
        process.env.RENTNERPROXY_SMOKE_REUSE_IMAGES === '1',
        'Explicit smoke image reuse is required',
    )
    const scope = smokeRunScope()
    requireValue(scope, 'Explicit smoke run scope is required')
    const image = sharedSmokeImage(kind)
    requireValue(image, 'Shared smoke image name is required')
    const directory = process.env.RUNTIME_IMAGE_DIRECTORY
    requireValue(directory, 'Runtime image directory is required')
    const archive = join(resolve(directory), 'image.tar')
    const identityPath = join(resolve(directory), 'identity.json')
    const archiveSha256 = await hashFile(archive)
    let identity: Record<string, unknown> | undefined
    let identitySha256: string | undefined
    if (action === 'load') {
        const expectedArchive = process.env.RUNTIME_IMAGE_ARCHIVE_SHA256 ?? ''
        const expectedIdentity = process.env.RUNTIME_IMAGE_IDENTITY_SHA256 ?? ''
        requireValue(
            sha256.test(expectedArchive) && sha256.test(expectedIdentity),
            'Expected artifact hashes are required',
        )
        identitySha256 = await hashFile(identityPath, 65_536)
        requireValue(
            archiveSha256 === expectedArchive && identitySha256 === expectedIdentity,
            'Image artifact hash mismatch',
        )
        identity = boundedJson(await readFile(identityPath, 'utf8'))
        requireValue(
            Object.keys(identity).length === identityKeys.length &&
                identityKeys.every((key) => Object.hasOwn(identity!, key)),
            'Invalid image identity schema',
        )
    }
    const revision = (await command(['git', 'rev-parse', 'HEAD'])).trim()
    requireValue(
        /^[a-f0-9]{40}$/u.test(revision) && revision === process.env.GITHUB_SHA,
        'Image checkout revision mismatch',
    )
    const labelsMatch = (value: unknown) => {
        const labels = record(value)
        requireValue(
            labels['org.opencontainers.image.revision'] === revision &&
                labels['io.rentnerproxy.smoke-source'] === revision,
            'Image source revision mismatch',
        )
        requireValue(labels[SMOKE_RUN_LABEL] === scope, 'Image smoke run mismatch')
        requireValue(labels['io.rentnerproxy.smoke-image'] === kind, 'Image kind mismatch')
    }
    if (identity) {
        requireValue(
            identity.schemaVersion === 1 &&
                identity.revision === revision &&
                identity.scope === scope &&
                identity.kind === kind &&
                identity.platform === platform &&
                identity.archiveSha256 === archiveSha256,
            'Image identity contract mismatch',
        )
        requireValue(
            typeof identity.manifestDigest === 'string' &&
                digest.test(identity.manifestDigest) &&
                typeof identity.imageId === 'string' &&
                digest.test(identity.imageId),
            'Invalid image identity digest',
        )
    }
    const inspected = boundedJson(
        await command([
            'skopeo',
            'inspect',
            '--override-os',
            'linux',
            '--override-arch',
            architecture,
            `oci-archive:${archive}`,
        ]),
    )
    requireValue(
        inspected.Os === 'linux' && inspected.Architecture === architecture,
        'Image platform mismatch',
    )
    labelsMatch(inspected.Labels)
    requireValue(
        typeof inspected.Digest === 'string' && digest.test(inspected.Digest),
        'Invalid OCI manifest digest',
    )
    requireValue(
        !identity || identity.manifestDigest === inspected.Digest,
        'OCI manifest digest mismatch',
    )
    await command([
        'skopeo',
        'copy',
        '--quiet',
        '--override-os',
        'linux',
        '--override-arch',
        architecture,
        `oci-archive:${archive}`,
        `docker-daemon:${image}`,
    ])
    const loaded = boundedJson(
        await command(['docker', 'image', 'inspect', '--format', '{{json .}}', image]),
    )
    requireValue(
        loaded.Os === 'linux' && loaded.Architecture === architecture,
        'Loaded image platform mismatch',
    )
    labelsMatch(record(loaded.Config).Labels)
    requireValue(
        typeof loaded.Id === 'string' && digest.test(loaded.Id),
        'Invalid loaded image identity',
    )
    requireValue(!identity || identity.imageId === loaded.Id, 'Loaded image identity mismatch')
    if (action === 'pack') {
        await writeFile(
            identityPath,
            JSON.stringify({
                schemaVersion: 1,
                revision,
                scope,
                kind,
                platform,
                manifestDigest: inspected.Digest,
                imageId: loaded.Id,
                archiveSha256,
            }) + '\n',
            { flag: 'wx' },
        )
        identitySha256 = await hashFile(identityPath, 65_536)
    }
    requireValue(identitySha256, 'Image identity hash is required')
    const hashes = { archive_sha256: archiveSha256, identity_sha256: identitySha256 }
    if (process.env.GITHUB_OUTPUT)
        await appendFile(
            process.env.GITHUB_OUTPUT,
            `archive_sha256=${hashes.archive_sha256}\nidentity_sha256=${hashes.identity_sha256}\n`,
        )
    return hashes
}

if (import.meta.main) {
    try {
        await runtimeImageArtifact(process.argv[2] ?? '')
    } catch {
        console.error(
            'Runtime image artifact verification failed; no fallback build was attempted.',
        )
        process.exitCode = 1
    }
}
