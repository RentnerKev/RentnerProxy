import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, test } from 'bun:test'

import {
    buildReleaseReadiness,
    parseReleaseReadinessInput,
} from '../../../../../.github/scripts/release/generate-release-readiness.ts'
import type { ReleaseReadinessInput } from '../../../../../.github/scripts/release/Types/release-readiness.types.ts'

function input(overrides: Partial<ReleaseReadinessInput> = {}): ReleaseReadinessInput {
    return {
        repository: 'RentnerKev/RentnerProxy',
        releaseId: '257',
        tag: 'v1.0.0-beta.2',
        channel: 'beta',
        prerelease: 'true',
        publishedAt: '2026-10-19T12:34:56Z',
        revision: 'a'.repeat(40),
        image: 'ghcr.io/rentnerkev/rentnerproxy',
        digest: 'sha256:' + 'b'.repeat(64),
        platforms: 'linux/amd64',
        ...overrides,
    }
}

describe('versioned release readiness generation', () => {
    test('binds the asset to the original release and assessed immutable image', () => {
        expect(buildReleaseReadiness(input())).toEqual({
            schemaVersion: 1,
            releaseId: 257,
            tag: 'v1.0.0-beta.2',
            channel: 'beta',
            publishedAt: '2026-10-19T12:34:56Z',
            revision: 'a'.repeat(40),
            image: {
                repository: 'ghcr.io/rentnerkev/rentnerproxy',
                digest: 'sha256:' + 'b'.repeat(64),
                platforms: ['linux/amd64'],
            },
            upgrade: { policy: 'beta1-appliance-v1', minimumVersion: 'v1.0.0-beta.1' },
        })
    })

    test.each([
        ['v1.0.0-beta.2', 'beta', true],
        ['v1.0.0-beta.10', 'beta', true],
        ['v1.0.0-beta.2.0', 'beta', true],
        ['v1.0.0-beta.text', 'beta', true],
        ['v1.0.0-beta.99999999999999999999999', 'beta', true],
        ['v1.0.0', 'stable', true],
        ['v1.2.0-beta', 'beta', true],
        ['v1.0.0-beta', 'beta', false],
        ['v1.0.0-beta.1', 'beta', false],
        ['v1.0.0-beta.1.extra', 'beta', false],
        ['v1.9.0-alpha.9', 'alpha', false],
        ['v2.0.0', 'stable', false],
        ['v0.9.0-beta.9', 'beta', false],
    ])('limits upgrade policy for %s', (tag, channel, automatic) => {
        expect(
            buildReleaseReadiness(
                input({ tag, channel, prerelease: channel === 'stable' ? 'false' : 'true' }),
            ).upgrade,
        ).toEqual(
            automatic
                ? { policy: 'beta1-appliance-v1', minimumVersion: 'v1.0.0-beta.1' }
                : { policy: 'manual-review', minimumVersion: null },
        )
    })

    test.each([
        { repository: 'attacker/RentnerProxy' },
        { image: 'ghcr.io/attacker/rentnerproxy' },
        { releaseId: '0' },
        { releaseId: '01' },
        { releaseId: '9007199254740992' },
        { releaseId: '257\ninjected=1' },
        { tag: 'v01.0.0-beta.2' },
        { tag: 'v1.0.0-beta.02' },
        { tag: 'v1.0.0-beta.2.01' },
        { tag: 'v1.0.0-beta.2+build' },
        { tag: 'v1.0.0-rc.2' },
        { tag: 'v1.0.0-betatron' },
        { tag: 'v1.0.0-beta.2\n' },
        { tag: 'v1.0.0-beta.' + '9'.repeat(129) },
        { channel: 'stable' },
        { prerelease: 'false' },
        { publishedAt: '' },
        { publishedAt: '2026-02-30T12:34:56Z' },
        { publishedAt: '2026-10-19T12:34:56Z\n' },
        { revision: 'a'.repeat(39) },
        { revision: 'A'.repeat(40) },
        { digest: 'sha256:' + 'B'.repeat(64) },
        { digest: 'sha256:' + 'b'.repeat(63) },
        { digest: 'sha256:' + 'b'.repeat(64) + '\n' },
        { platforms: 'linux/amd64,linux/arm64' },
        { platforms: 'linux/arm64' },
    ])('rejects unbound or malformed release metadata %j', (overrides) => {
        expect(() => parseReleaseReadinessInput(input(overrides))).toThrow()
        expect(() => buildReleaseReadiness(input(overrides))).toThrow()
    })
})

test('publishes readiness last with trusted automation and the assessed build digest', async () => {
    const root = resolve(import.meta.dir, '../../../../..')
    const pipeline = (
        await readFile(resolve(root, '.github/workflows/release-pipeline.yml'), 'utf8')
    ).replaceAll('\r\n', '\n')
    const publish = pipeline.slice(pipeline.indexOf('    publish:\n'))
    expect(publish).toMatch(/needs:\s+- prepare\s+- build\s+- publish-image/)
    expect(publish).toContain('RELEASE_DIGEST: ${{ needs.build.outputs.digest }}')
    expect(publish).toContain('RELEASE_REVISION: ${{ needs.prepare.outputs.revision }}')
    expect(publish).toContain('RELEASE_PLATFORMS: linux/amd64')
    expect(publish).toContain('ref: ${{ github.workflow_sha }}')
    expect(publish.indexOf('publish-release-readiness.sh')).toBeGreaterThan(
        publish.indexOf('publish-release-notes.sh'),
    )
    expect(publish.trimEnd().endsWith('publish-release-readiness.sh')).toBeTrue()

    const script = await readFile(
        resolve(root, '.github/scripts/release/publish-release-readiness.sh'),
        'utf8',
    )
    const identity = script.indexOf('bash "$script_directory/verify-release-identity.sh"')
    const generate = script.indexOf('bun --no-env-file')
    const upload = script.indexOf('gh release upload')
    expect(identity).toBeGreaterThan(-1)
    expect(generate).toBeGreaterThan(identity)
    expect(upload).toBeGreaterThan(generate)
    expect(script).toContain('set -Eeuo pipefail')
    expect(script).toContain('rentnerproxy-update.json')
})
