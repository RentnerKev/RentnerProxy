// oxlint-disable no-await-in-loop -- prepare images in order and verify each build before use.
import assert from 'node:assert/strict'
import { smokeDockerArguments, smokeRunScope, SMOKE_RUN_LABEL } from './resources.ts'
import type { Http3Command } from './http3/Types/client.types.ts'
import type { SmokeImageKind } from './Types/images.types.ts'

const imageDockerfiles: Record<SmokeImageKind, string> = {
    'proxy-runtime': 'docker/proxy-runtime/Dockerfile',
    appliance: 'docker/production/Dockerfile',
    'http3-client': 'scripts/smoke/http3/Dockerfile',
}
const sourceLabel = 'io.rentnerproxy.smoke-source'
const kindLabel = 'io.rentnerproxy.smoke-image'

export function sharedSmokeImage(kind: SmokeImageKind): string | undefined {
    if (process.env.RENTNERPROXY_SMOKE_REUSE_IMAGES !== '1') return undefined
    const scope = smokeRunScope()
    assert.ok(scope, 'Image reuse requires a validated smoke run scope')
    return 'rentnerproxy-smoke-' + scope + ':' + kind
}

async function sourceRevision(command: Http3Command): Promise<string> {
    const revision = (await command(['git', 'rev-parse', 'HEAD'])).trim()
    assert.match(revision, /^[a-f0-9]{40}$/u)
    return revision
}

export async function verifySharedSmokeImage(
    command: Http3Command,
    kind: SmokeImageKind,
): Promise<void> {
    const image = sharedSmokeImage(kind)
    assert.ok(image, 'Shared smoke images require explicit reuse mode')
    const revision = await sourceRevision(command)
    const output = await command([
        'docker',
        'image',
        'inspect',
        '--format',
        '{{json .Config.Labels}}',
        image,
    ])
    const labels = JSON.parse(output) as Record<string, unknown> | null
    assert.equal(labels?.[SMOKE_RUN_LABEL], smokeRunScope(), 'Image belongs to another smoke run')
    assert.equal(labels?.[sourceLabel], revision, 'Image belongs to another source revision')
    assert.equal(labels?.[kindLabel], kind, 'Image uses another smoke build contract')
}

export async function prepareSmokeImages(command: Http3Command): Promise<void> {
    assert.ok(sharedSmokeImage('proxy-runtime'), 'Preparing images requires explicit reuse mode')
    const revision = await sourceRevision(command)
    for (const kind of Object.keys(imageDockerfiles) as SmokeImageKind[]) {
        const image = sharedSmokeImage(kind)!
        await command(
            smokeDockerArguments([
                'docker',
                'build',
                '--file',
                imageDockerfiles[kind],
                '--tag',
                image,
                '--label',
                sourceLabel + '=' + revision,
                '--label',
                kindLabel + '=' + kind,
                '.',
            ]),
            { timeoutMs: 1_800_000 },
        )
        await verifySharedSmokeImage(command, kind)
        if (kind === 'http3-client') {
            const version = await command(
                smokeDockerArguments(['docker', 'run', '--rm', image, '--version']),
            )
            assert.match(version, /Features:.*\bHTTP2\b.*\bHTTP3\b/u)
        }
    }
}
