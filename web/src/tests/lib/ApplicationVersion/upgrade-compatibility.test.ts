import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CURRENT_COMPATIBILITY_PROFILE } from '@/config/compatibility.config.ts'
import type { CompatibilityProfile } from '@/lib/ApplicationVersion/Types/compatibility.types.ts'
import type { ReleaseReadiness } from '@/lib/ApplicationVersion/Types/release-readiness.types.ts'
import {
    getReadinessUpgrade,
    getUpgradeCompatibility,
    isSupportedUpgradeSource,
    isSupportedUpgradeTarget,
} from '@/lib/ApplicationVersion/upgradeCompatibility.ts'

function readiness(tag = 'v1.0.0-beta.3'): ReleaseReadiness {
    return {
        schemaVersion: 1,
        releaseId: 42,
        tag,
        channel: tag.includes('-beta') ? 'beta' : 'stable',
        publishedAt: '2026-10-24T12:00:00Z',
        revision: 'a'.repeat(40),
        image: {
            repository: 'ghcr.io/rentnerkev/rentnerproxy',
            digest: 'sha256:' + 'b'.repeat(64),
            platforms: ['linux/amd64'],
        },
        upgrade: getReadinessUpgrade(tag),
    }
}

describe('reviewed data compatibility generation', () => {
    test('keeps the Beta 1/2 wire contract and backup format independent of the next beta', () => {
        expect(CURRENT_COMPATIBILITY_PROFILE).toEqual({
            generation: 'appliance-v1',
            major: '1',
            sourceChannels: ['beta', 'stable'],
            targetChannels: ['beta', 'stable'],
            minimumSourceVersion: 'v1.0.0-beta.1',
            minimumTargetVersion: 'v1.0.0-beta.2',
            backup: { writtenVersion: 4, acceptedVersions: [4] },
        })
        expect(getReadinessUpgrade('v1.0.0-beta.3')).toEqual({
            policy: 'beta1-appliance-v1',
            minimumVersion: 'v1.0.0-beta.1',
        })
    })

    test.each(['v1.0.0-beta.3', 'v1.0.0-beta.4', 'v1.0.0-beta.10', 'v1.0.0', 'v1.2.0-beta.1'])(
        'supports both published betas as sources for %s without new per-beta rules',
        (target) => {
            for (const source of ['v1.0.0-beta.1', 'v1.0.0-beta.2']) {
                expect(getUpgradeCompatibility(source, target, readiness(target))).toEqual({
                    status: 'supported',
                    minimumVersion: 'v1.0.0-beta.1',
                    intermediateVersion: null,
                })
            }
        },
    )

    test.each<Partial<CompatibilityProfile>>([
        { generation: 'appliance-v2' },
        { major: '2' },
        { minimumSourceVersion: 'v1.0.0-beta.2' },
        { minimumTargetVersion: 'v1.0.0-beta.1' },
        { sourceChannels: ['alpha', 'beta', 'stable'] },
        { targetChannels: ['alpha', 'beta', 'stable'] },
        { backup: { writtenVersion: 5, acceptedVersions: [4, 5] } },
        { backup: { writtenVersion: 4, acceptedVersions: [3, 4] } },
    ])('never reuses the legacy policy for a changed contract %j', (changes) => {
        const changed = { ...CURRENT_COMPATIBILITY_PROFILE, ...changes }
        expect(getReadinessUpgrade('v1.0.0-beta.3', changed)).toEqual({
            policy: 'manual-review',
            minimumVersion: null,
        })
        expect(isSupportedUpgradeSource('v1.0.0-beta.1', changed)).toBe(false)
        expect(isSupportedUpgradeTarget('v1.0.0-beta.3', changed)).toBe(false)
    })

    test.each<Partial<CompatibilityProfile>>([
        { generation: 'appliance-v2' },
        { minimumSourceVersion: 'v1.0.0-beta.2' },
        { backup: { writtenVersion: 5, acceptedVersions: [5] } },
    ])(
        'keeps the old wire meaning when the actual active configuration changes: %j',
        async (changes) => {
            const directory = await mkdtemp(join(tmpdir(), 'rp-upgrade-contract-'))
            try {
                const modules = join(directory, 'lib', 'ApplicationVersion')
                const configuration = join(directory, 'config')
                await Promise.all([mkdir(modules, { recursive: true }), mkdir(configuration)])
                await Promise.all([
                    ...[
                        'legacyUpgradeContract.ts',
                        'upgradeCompatibility.ts',
                        'releaseVersion.ts',
                    ].map(async (file) => {
                        const source = await readFile(
                            new URL(`../../../lib/ApplicationVersion/${file}`, import.meta.url),
                        )
                        await writeFile(join(modules, file), source)
                    }),
                    writeFile(
                        join(configuration, 'compatibility.config.ts'),
                        `export const CURRENT_COMPATIBILITY_PROFILE = ${JSON.stringify({ ...CURRENT_COMPATIBILITY_PROFILE, ...changes })} as const\n`,
                    ),
                ])
                const child = Bun.spawn(
                    [
                        process.execPath,
                        '--no-env-file',
                        '-e',
                        'import { getReadinessUpgrade } from "./upgradeCompatibility.ts"; console.log(JSON.stringify(getReadinessUpgrade("v1.0.0-beta.3")))',
                    ],
                    { cwd: modules, env: {}, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
                )
                const timer = setTimeout(() => child.kill(), 5_000)
                try {
                    const [status, stdout, stderr] = await Promise.all([
                        child.exited,
                        new Response(child.stdout).text(),
                        new Response(child.stderr).text(),
                    ])
                    expect({ status, stderr }).toEqual({ status: 0, stderr: '' })
                    expect(JSON.parse(stdout)).toEqual({
                        policy: 'manual-review',
                        minimumVersion: null,
                    })
                } finally {
                    clearTimeout(timer)
                }
            } finally {
                await rm(directory, { recursive: true, force: true })
            }
        },
    )

    test.each([
        ['v1.0.0-beta.2', 'v1.0.0-beta.2'],
        ['v1.0.0-beta.3', 'v1.0.0-beta.2'],
        ['v1.0.0', 'v1.1.0-beta.1'],
        ['v1.0.0-beta.0', 'v1.0.0-beta.3'],
        ['v0.9.0-beta.1', 'v1.0.0-beta.3'],
        ['v1.0.0-beta.2', 'v2.0.0'],
        ['v2.0.0-beta.1', 'v2.0.0'],
        ['dev-sha', 'v1.0.0-beta.3'],
    ])(
        'does not infer a supported path from version ordering alone: %s to %s',
        (source, target) => {
            expect(getUpgradeCompatibility(source!, target!, readiness(target)).status).toBe(
                'unsupported',
            )
        },
    )

    test('binds the compatibility declaration to the requested target', () => {
        expect(getUpgradeCompatibility('v1.0.0-beta.2', 'v1.0.0-beta.4', readiness()).status).toBe(
            'unsupported',
        )
        expect(getUpgradeCompatibility('v1.0.0-beta.2', 'v1.0.0-beta.3', null).status).toBe(
            'unsupported',
        )
    })

    test('retains the Alpha bridge while refusing a downgrade or explicit manual review', () => {
        expect(getUpgradeCompatibility('v1.0.0-alpha.6', 'v1.0.0-beta.3', null)).toEqual({
            status: 'requires-beta1',
            minimumVersion: 'v1.0.0-beta.1',
            intermediateVersion: 'v1.0.0-beta.1',
        })
        expect(getUpgradeCompatibility('v1.1.0-alpha.1', 'v1.2.0-beta.1', null).status).toBe(
            'unsupported',
        )
        expect(
            getUpgradeCompatibility('v1.0.0-alpha.6', 'v1.0.0-beta.3', {
                ...readiness(),
                upgrade: { policy: 'manual-review', minimumVersion: null },
            }).status,
        ).toBe('unsupported')
    })
})
