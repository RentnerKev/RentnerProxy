import { imagePlatform } from '../../../web/src/lib/ApplicationVersion/imagePlatform.ts'
import { parseReleaseVersion } from '../../../web/src/lib/ApplicationVersion/releaseVersion.ts'
import { ociDigest, ociRecord } from '../lib/oci-layout.ts'
import type {
    DistributionRelease,
    DistributionTarget,
    PackageVersion,
} from './Types/distribution.types.ts'

export const distributionTargets: readonly DistributionTarget[] = [
    { id: 'debian-13', format: 'deb', podmanMinimum: '5.4', systemdMinimum: 252 },
    { id: 'fedora-44', format: 'rpm', podmanMinimum: '5.4', systemdMinimum: 252 },
]

export function parseDistributionRelease(raw: unknown): DistributionRelease {
    const value = ociRecord(raw)
    const version = typeof value.version === 'string' && parseReleaseVersion(value.version)
    const platform = typeof value.platform === 'string' && imagePlatform(value.platform)
    if (
        value.schemaVersion !== 1 ||
        !version ||
        version.version.includes('+') ||
        value.version !== 'v' + version.version ||
        typeof value.revision !== 'string' ||
        !/^[a-f0-9]{40}$/u.test(value.revision) ||
        !platform ||
        value.platform !== platform ||
        typeof value.packageRevision !== 'number' ||
        !Number.isSafeInteger(value.packageRevision) ||
        value.packageRevision < 1 ||
        value.packageRevision > 999
    )
        throw new Error('Invalid immutable distribution release')
    return {
        schemaVersion: 1,
        version: value.version as string,
        revision: value.revision,
        digest: ociDigest(value.digest),
        platform,
        packageRevision: value.packageRevision,
    }
}

// RPM sorts numeric segments above alphabetic ones, unlike SemVer. Typed tokens
// and an explicit terminator preserve numeric/string, ASCII and prefix ordering
// in both package managers, including the existing nonnumeric alpha/beta tags.
function packagePrerelease(prerelease: string): string {
    const [channel, ...identifiers] = prerelease.split('.')
    const alphabet = 'bcdefghijklmnopq'
    const tokens = identifiers.map((identifier) => {
        if (/^[0-9]+$/u.test(identifier)) return 'b' + identifier
        return (
            'c' +
            [...Buffer.from(identifier, 'ascii')]
                .map((byte) => alphabet[byte >> 4]! + alphabet[byte & 15]!)
                .join('') +
            'a'
        )
    })
    return [channel, ...tokens, 'a'].join('.')
}

export function distributionPackageVersion(version: string, revision = 1): PackageVersion {
    const parsed = parseReleaseVersion(version)
    if (
        !parsed ||
        parsed.version.includes('+') ||
        version !== 'v' + parsed.version ||
        !Number.isSafeInteger(revision) ||
        revision < 1 ||
        revision > 999
    )
        throw new Error('Unsupported distribution package version')
    const [base, ...suffix] = parsed.version.split('-')
    const prerelease = suffix.length ? packagePrerelease(suffix.join('-')) : null
    return {
        channel: parsed.channel,
        debian: `${base}${prerelease ? '~' + prerelease : ''}-${revision}`,
        rpmVersion: base!,
        rpmRelease: prerelease ? `0.${prerelease}.${revision}` : String(revision),
    }
}

export function packageArchitecture(
    platform: DistributionRelease['platform'],
    format: DistributionTarget['format'],
): string {
    if (format === 'deb') return platform === 'linux/arm64' ? 'arm64' : 'amd64'
    return platform === 'linux/arm64' ? 'aarch64' : 'x86_64'
}
