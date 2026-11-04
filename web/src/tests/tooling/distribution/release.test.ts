import { describe, expect, test } from 'bun:test'
import {
    distributionPackageVersion,
    packageArchitecture,
    parseDistributionRelease,
} from '../../../../../.github/scripts/distribution/release.ts'

const release = {
    schemaVersion: 1,
    version: 'v1.0.0-beta.3',
    revision: 'a'.repeat(40),
    digest: 'sha256:' + 'b'.repeat(64),
    platform: 'linux/arm64',
    packageRevision: 1,
} as const

describe('immutable Linux distribution identity', () => {
    test('binds each native package to its assessed image and source', () => {
        expect(parseDistributionRelease(release)).toEqual(release)
        expect(packageArchitecture('linux/arm64', 'deb')).toBe('arm64')
        expect(packageArchitecture('linux/arm64', 'rpm')).toBe('aarch64')
        expect(packageArchitecture('linux/amd64', 'deb')).toBe('amd64')
        expect(packageArchitecture('linux/amd64', 'rpm')).toBe('x86_64')
    })
    test.each([
        { schemaVersion: 2 },
        { version: 'dev-' + 'a'.repeat(40) },
        { version: '1.0.0-beta.3' },
        { revision: 'main' },
        { digest: 'latest' },
        { platform: 'linux/arm64/v8' },
        { platform: 'linux/riscv64' },
        { packageRevision: 0 },
        { packageRevision: 1000 },
        { packageRevision: 1.1 },
    ])('rejects ambiguous or unbound package identities: %j', (change) => {
        expect(() => parseDistributionRelease({ ...release, ...change })).toThrow()
    })
    test('keeps the real application version separate from package-manager ordering', () => {
        expect(distributionPackageVersion('v1.0.0')).toMatchObject({
            debian: '1.0.0-1',
            rpmVersion: '1.0.0',
            rpmRelease: '1',
            channel: 'stable',
        })
        const beta = distributionPackageVersion(release.version)
        expect(beta.channel).toBe('beta')
        expect(beta.debian).toStartWith('1.0.0~beta.')
        expect(beta.rpmRelease).toStartWith('0.beta.')
        expect(distributionPackageVersion('v1.0.0-alpha.test-alpha').channel).toBe('alpha')
        expect(distributionPackageVersion(release.version, 2).rpmRelease).toEndWith('.2')
        expect(() => distributionPackageVersion('dev')).toThrow()
        expect(() => distributionPackageVersion(release.version, -1)).toThrow()
    })
})
