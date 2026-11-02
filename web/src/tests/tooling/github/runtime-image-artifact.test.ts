import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { runtimeImageArtifact } from '../../../../../.github/scripts/ci/runtime-image-artifact.ts'

const revision = 'a'.repeat(40)
const manifestDigest = 'sha256:' + 'b'.repeat(64)
const imageId = 'sha256:' + 'c'.repeat(64)
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const environmentKeys = [
    'RUNTIME_IMAGE_DIRECTORY',
    'RUNTIME_IMAGE_KIND',
    'RENTNERPROXY_SMOKE_RUN',
    'RENTNERPROXY_SMOKE_REUSE_IMAGES',
    'GITHUB_SHA',
    'GITHUB_OUTPUT',
    'RUNTIME_IMAGE_ARCHIVE_SHA256',
    'RUNTIME_IMAGE_IDENTITY_SHA256',
] as const

async function fixture(
    run: (context: {
        directory: string
        calls: string[][]
        oci: Record<string, unknown>
        docker: Record<string, unknown>
        command: (args: string[]) => Promise<string>
    }) => Promise<void>,
    kind = 'appliance',
) {
    const directory = await mkdtemp(join(tmpdir(), 'rentnerproxy-image-artifact-'))
    const previous = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]))
    Object.assign(process.env, {
        RUNTIME_IMAGE_DIRECTORY: directory,
        RUNTIME_IMAGE_KIND: kind,
        RENTNERPROXY_SMOKE_RUN: '12345-2',
        RENTNERPROXY_SMOKE_REUSE_IMAGES: '1',
        GITHUB_SHA: revision,
        GITHUB_OUTPUT: join(directory, 'outputs'),
    })
    delete process.env.RUNTIME_IMAGE_ARCHIVE_SHA256
    delete process.env.RUNTIME_IMAGE_IDENTITY_SHA256
    const labels = {
        'org.opencontainers.image.revision': revision,
        'io.rentnerproxy.smoke-source': revision,
        'io.rentnerproxy.smoke-run': '12345-2',
        'io.rentnerproxy.smoke-image': kind,
    }
    const oci = {
        Os: 'linux',
        Architecture: 'amd64',
        Digest: manifestDigest,
        Labels: { ...labels },
    }
    const docker = {
        Os: 'linux',
        Architecture: 'amd64',
        Id: imageId,
        Config: { Labels: { ...labels } },
    }
    const calls: string[][] = []
    const command = (args: string[]): Promise<string> => {
        calls.push(args)
        if (args.join(' ') === 'git rev-parse HEAD') return Promise.resolve(revision)
        if (args[0] === 'skopeo' && args[1] === 'inspect')
            return Promise.resolve(JSON.stringify(oci))
        if (args[0] === 'skopeo' && args[1] === 'copy') return Promise.resolve('')
        if (args.slice(0, 3).join(' ') === 'docker image inspect')
            return Promise.resolve(JSON.stringify(docker))
        throw new Error('Unexpected command')
    }
    try {
        await writeFile(join(directory, 'image.tar'), 'fixture OCI archive bytes')
        await run({ directory, calls, oci, docker, command })
    } finally {
        for (const key of environmentKeys) {
            if (previous[key] === undefined) delete process.env[key]
            else process.env[key] = previous[key]
        }
        await rm(directory, { recursive: true, force: true })
    }
}

describe('same-run OCI runtime image artifacts', () => {
    for (const kind of ['appliance', 'http3-client', 'proxy-runtime']) {
        test(`${kind} packs and loads the same immutable image bytes`, async () => {
            await fixture(async ({ directory, command, calls }) => {
                const packed = await runtimeImageArtifact('pack', command)
                expect(packed.archive_sha256).toBe(hash('fixture OCI archive bytes'))
                const raw = await readFile(join(directory, 'identity.json'), 'utf8')
                expect(packed.identity_sha256).toBe(hash(raw))
                expect(JSON.parse(raw)).toEqual({
                    schemaVersion: 1,
                    revision,
                    scope: '12345-2',
                    kind,
                    platform: 'linux/amd64',
                    manifestDigest,
                    imageId,
                    archiveSha256: packed.archive_sha256,
                })
                process.env.RUNTIME_IMAGE_ARCHIVE_SHA256 = packed.archive_sha256
                process.env.RUNTIME_IMAGE_IDENTITY_SHA256 = packed.identity_sha256
                expect(await runtimeImageArtifact('load', command)).toEqual(packed)
                const copies = calls.filter((args) => args[0] === 'skopeo' && args[1] === 'copy')
                expect(copies).toHaveLength(2)
                expect(copies[0]?.at(-1)).toBe(`docker-daemon:rentnerproxy-smoke-12345-2:${kind}`)
                expect(
                    calls.some(
                        (args) =>
                            args.includes('run') || args.includes('build') || args.includes('push'),
                    ),
                ).toBe(false)
                expect(await readFile(join(directory, 'outputs'), 'utf8')).toContain(
                    `archive_sha256=${packed.archive_sha256}\nidentity_sha256=${packed.identity_sha256}\n`,
                )
            }, kind)
        })
    }

    for (const [filename, kind] of [
        ['image.tar', 'appliance'],
        ['identity.json', 'appliance'],
        ['image.tar', 'proxy-runtime'],
        ['identity.json', 'proxy-runtime'],
    ]) {
        test(`rejects tampered ${kind} ${filename} before any image commands`, async () => {
            await fixture(async ({ directory, command, calls }) => {
                const packed = await runtimeImageArtifact('pack', command)
                process.env.RUNTIME_IMAGE_ARCHIVE_SHA256 = packed.archive_sha256
                process.env.RUNTIME_IMAGE_IDENTITY_SHA256 = packed.identity_sha256
                await writeFile(join(directory, filename), 'tampered bytes')
                calls.length = 0
                await expect(runtimeImageArtifact('load', command)).rejects.toThrow('hash mismatch')
                expect(calls).toEqual([])
            }, kind)
        })
    }

    for (const [name, field, value] of [
        ['revision', 'revision', 'd'.repeat(40)],
        ['run', 'scope', '999-1'],
        ['kind', 'kind', 'http3-client'],
        ['platform', 'platform', 'linux/arm64'],
        ['manifest digest', 'manifestDigest', 'invalid'],
        ['image digest', 'imageId', 'invalid'],
        ['schema', 'schemaVersion', 2],
        ['unexpected field', 'extra', true],
    ] as const) {
        test(`rejects foreign identity ${name} even with a matching file hash`, async () => {
            await fixture(async ({ directory, command, calls }) => {
                const packed = await runtimeImageArtifact('pack', command)
                const metadata = JSON.parse(
                    await readFile(join(directory, 'identity.json'), 'utf8'),
                ) as Record<string, unknown>
                metadata[field] = value
                const raw = JSON.stringify(metadata)
                await writeFile(join(directory, 'identity.json'), raw)
                process.env.RUNTIME_IMAGE_ARCHIVE_SHA256 = packed.archive_sha256
                process.env.RUNTIME_IMAGE_IDENTITY_SHA256 = hash(raw)
                calls.length = 0
                await expect(runtimeImageArtifact('load', command)).rejects.toThrow()
                expect(calls.some((args) => args[0] === 'skopeo')).toBe(false)
            })
        })
    }

    for (const [name, mutate] of [
        [
            'source',
            (image: Record<string, unknown>) => {
                ;(image.Labels as Record<string, unknown>)['io.rentnerproxy.smoke-source'] =
                    'd'.repeat(40)
            },
        ],
        [
            'revision label',
            (image: Record<string, unknown>) => {
                ;(image.Labels as Record<string, unknown>)['org.opencontainers.image.revision'] =
                    'd'.repeat(40)
            },
        ],
        [
            'run',
            (image: Record<string, unknown>) => {
                ;(image.Labels as Record<string, unknown>)['io.rentnerproxy.smoke-run'] = '999-1'
            },
        ],
        [
            'kind',
            (image: Record<string, unknown>) => {
                ;(image.Labels as Record<string, unknown>)['io.rentnerproxy.smoke-image'] =
                    'http3-client'
            },
        ],
        [
            'platform',
            (image: Record<string, unknown>) => {
                image.Architecture = 'arm64'
            },
        ],
        [
            'digest',
            (image: Record<string, unknown>) => {
                image.Digest = 'sha256:' + 'e'.repeat(64)
            },
        ],
    ] as const) {
        test(`rejects changed OCI ${name} before importing into Docker`, async () => {
            await fixture(async ({ command, calls, oci }) => {
                const packed = await runtimeImageArtifact('pack', command)
                process.env.RUNTIME_IMAGE_ARCHIVE_SHA256 = packed.archive_sha256
                process.env.RUNTIME_IMAGE_IDENTITY_SHA256 = packed.identity_sha256
                mutate(oci)
                calls.length = 0
                await expect(runtimeImageArtifact('load', command)).rejects.toThrow()
                expect(calls.some((args) => args[1] === 'copy')).toBe(false)
            })
        })
    }

    test('rejects a loaded Docker image with a different immutable image ID', async () => {
        await fixture(async ({ command, docker }) => {
            const packed = await runtimeImageArtifact('pack', command)
            process.env.RUNTIME_IMAGE_ARCHIVE_SHA256 = packed.archive_sha256
            process.env.RUNTIME_IMAGE_IDENTITY_SHA256 = packed.identity_sha256
            docker.Id = 'sha256:' + 'd'.repeat(64)
            await expect(runtimeImageArtifact('load', command)).rejects.toThrow(
                'Loaded image identity mismatch',
            )
        })
    })

    for (const field of ['platform', 'labels']) {
        test(`rejects loaded Docker ${field} that differ from the OCI contract`, async () => {
            await fixture(async ({ command, docker }) => {
                const packed = await runtimeImageArtifact('pack', command)
                process.env.RUNTIME_IMAGE_ARCHIVE_SHA256 = packed.archive_sha256
                process.env.RUNTIME_IMAGE_IDENTITY_SHA256 = packed.identity_sha256
                if (field === 'platform') docker.Os = 'windows'
                else docker.Config = { Labels: {} }
                await expect(runtimeImageArtifact('load', command)).rejects.toThrow()
            })
        })
    }

    for (const raw of ['{invalid JSON', 'null', JSON.stringify('invalid'), 'x'.repeat(65_537)]) {
        test(`rejects malformed or oversized identity data (${raw.length} bytes)`, async () => {
            await fixture(async ({ directory, command, calls }) => {
                const packed = await runtimeImageArtifact('pack', command)
                await writeFile(join(directory, 'identity.json'), raw)
                process.env.RUNTIME_IMAGE_ARCHIVE_SHA256 = packed.archive_sha256
                process.env.RUNTIME_IMAGE_IDENTITY_SHA256 = hash(raw)
                calls.length = 0
                await expect(runtimeImageArtifact('load', command)).rejects.toThrow()
                expect(calls).toEqual([])
            })
        })
    }

    test('missing archives and identities fail without image inspection or loading', async () => {
        await fixture(async ({ directory, command, calls }) => {
            process.env.RUNTIME_IMAGE_ARCHIVE_SHA256 = hash('fixture OCI archive bytes')
            process.env.RUNTIME_IMAGE_IDENTITY_SHA256 = hash('missing identity')
            await expect(runtimeImageArtifact('load', command)).rejects.toThrow()
            await rm(join(directory, 'image.tar'))
            await expect(runtimeImageArtifact('pack', command)).rejects.toThrow()
            expect(calls).toEqual([])
        })
    })

    test('requires explicit reuse, scope, expected revision and consumer hashes', async () => {
        await fixture(async ({ command }) => {
            await expect(runtimeImageArtifact('load', command)).rejects.toThrow(
                'hashes are required',
            )
            process.env.RENTNERPROXY_SMOKE_REUSE_IMAGES = '0'
            await expect(runtimeImageArtifact('pack', command)).rejects.toThrow('reuse')
            process.env.RENTNERPROXY_SMOKE_REUSE_IMAGES = '1'
            process.env.RENTNERPROXY_SMOKE_RUN = ''
            await expect(runtimeImageArtifact('pack', command)).rejects.toThrow('scope')
            process.env.RENTNERPROXY_SMOKE_RUN = '12345-2'
            process.env.GITHUB_SHA = 'f'.repeat(40)
            await expect(runtimeImageArtifact('pack', command)).rejects.toThrow('revision mismatch')
        })
    })

    test('proxy-runtime loading requires both expected artifact hashes', async () => {
        await fixture(async ({ command, calls }) => {
            const packed = await runtimeImageArtifact('pack', command)
            calls.length = 0
            process.env.RUNTIME_IMAGE_ARCHIVE_SHA256 = packed.archive_sha256
            await expect(runtimeImageArtifact('load', command)).rejects.toThrow(
                'hashes are required',
            )
            delete process.env.RUNTIME_IMAGE_ARCHIVE_SHA256
            process.env.RUNTIME_IMAGE_IDENTITY_SHA256 = packed.identity_sha256
            await expect(runtimeImageArtifact('load', command)).rejects.toThrow(
                'hashes are required',
            )
            expect(calls).toEqual([])
        }, 'proxy-runtime')
    })
})
