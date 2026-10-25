import type { ReleaseChannel } from '../../features/ApplicationVersion/Types/application-update.types.ts'
import type { ParsedReleaseVersion } from './Types/release-version.types.ts'

// Numeric prerelease identifiers cannot have leading zeroes. Build metadata has no precedence.
const versionPattern =
    /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const excludedBuild = /(?:^|[.+-])(?:dev|pr|preview)(?:$|[.+-])/i
const channelRank: Record<ReleaseChannel, number> = { alpha: 0, beta: 1, stable: 2 }

export function parseReleaseVersion(value: string): ParsedReleaseVersion | null {
    if (value.length > 128 || excludedBuild.test(value)) return null
    const match = versionPattern.exec(value)
    if (!match) return null
    const firstIdentifier = match[4]?.split('.')[0]
    const channel = firstIdentifier === undefined ? 'stable' : firstIdentifier
    if (channel !== 'alpha' && channel !== 'beta' && channel !== 'stable') return null
    // "stable" is a channel only for a version without prerelease identifiers.
    if (firstIdentifier === 'stable') return null
    return {
        version: value.replace(/^v/, ''),
        channel,
        major: match[1]!,
        minor: match[2]!,
        patch: match[3]!,
        prerelease: match[4]?.split('.') ?? [],
    }
}

export function isNewerEligibleRelease(
    current: ParsedReleaseVersion,
    target: ParsedReleaseVersion,
): boolean {
    return (
        channelRank[target.channel] >= channelRank[current.channel] &&
        compareReleaseVersions(target.version, current.version) > 0
    )
}

export function compareReleaseVersions(left: string, right: string): number {
    const a = parseReleaseVersion(left)
    const b = parseReleaseVersion(right)
    if (!a || !b) throw new Error('Cannot compare invalid release versions')
    for (const part of ['major', 'minor', 'patch'] as const) {
        const difference = compareDecimal(a[part], b[part])
        if (difference !== 0) return difference
    }
    if (a.prerelease.length === 0 || b.prerelease.length === 0)
        return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length === 0 ? 1 : -1
    for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index++) {
        const first = a.prerelease[index]
        const second = b.prerelease[index]
        if (first === undefined || second === undefined) return first === undefined ? -1 : 1
        const firstNumeric = /^[0-9]+$/.test(first)
        const secondNumeric = /^[0-9]+$/.test(second)
        const difference =
            firstNumeric && secondNumeric
                ? compareDecimal(first, second)
                : firstNumeric !== secondNumeric
                  ? firstNumeric
                      ? -1
                      : 1
                  : first === second
                    ? 0
                    : first < second
                      ? -1
                      : 1
        if (difference !== 0) return difference
    }
    return 0
}

// Decimal strings preserve SemVer ordering beyond Number/Bun comparator integer limits.
function compareDecimal(left: string, right: string): number {
    if (left.length !== right.length) return left.length < right.length ? -1 : 1
    return left === right ? 0 : left < right ? -1 : 1
}
