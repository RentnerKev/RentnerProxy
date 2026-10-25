import type { ApplicationUpdate } from '../../features/ApplicationVersion/Types/application-update.types.ts'
import { CURRENT_COMPATIBILITY_PROFILE } from '../../config/compatibility.config.ts'
import { LEGACY_UPGRADE_CONTRACT } from './legacyUpgradeContract.ts'
import {
    compareReleaseVersions,
    isNewerEligibleRelease,
    parseReleaseVersion,
} from './releaseVersion.ts'
import type { CompatibilityProfile } from './Types/compatibility.types.ts'
import type { ReleaseReadiness } from './Types/release-readiness.types.ts'

function matchesReviewedProfile(profile: CompatibilityProfile): boolean {
    const reviewed = LEGACY_UPGRADE_CONTRACT.profile
    return (
        profile.generation === reviewed.generation &&
        profile.major === reviewed.major &&
        profile.minimumSourceVersion === reviewed.minimumSourceVersion &&
        profile.minimumTargetVersion === reviewed.minimumTargetVersion &&
        profile.sourceChannels.length === reviewed.sourceChannels.length &&
        profile.sourceChannels.every(
            (channel, index) => channel === reviewed.sourceChannels[index],
        ) &&
        profile.targetChannels.length === reviewed.targetChannels.length &&
        profile.targetChannels.every(
            (channel, index) => channel === reviewed.targetChannels[index],
        ) &&
        profile.backup.writtenVersion === reviewed.backup.writtenVersion &&
        profile.backup.acceptedVersions.length === reviewed.backup.acceptedVersions.length &&
        profile.backup.acceptedVersions.every(
            (version, index) => version === reviewed.backup.acceptedVersions[index],
        )
    )
}

export function isSupportedUpgradeSource(
    version: string,
    profile: CompatibilityProfile = CURRENT_COMPATIBILITY_PROFILE,
): boolean {
    const source = parseReleaseVersion(version)
    return (
        matchesReviewedProfile(profile) &&
        source !== null &&
        source.major === profile.major &&
        profile.sourceChannels.includes(source.channel) &&
        compareReleaseVersions(source.version, profile.minimumSourceVersion) >= 0
    )
}

export function isSupportedUpgradeTarget(
    version: string,
    profile: CompatibilityProfile = CURRENT_COMPATIBILITY_PROFILE,
): boolean {
    const target = parseReleaseVersion(version)
    return (
        matchesReviewedProfile(profile) &&
        target !== null &&
        target.major === profile.major &&
        profile.targetChannels.includes(target.channel) &&
        compareReleaseVersions(target.version, profile.minimumTargetVersion) >= 0
    )
}

export function getReadinessUpgrade(
    targetVersion: string,
    profile: CompatibilityProfile = CURRENT_COMPATIBILITY_PROFILE,
): ReleaseReadiness['upgrade'] {
    // Beta 1/2 readers ignore additive fields. Only this exact reviewed contract may use
    // their existing policy; a new generation must explicitly introduce a new protocol.
    return isSupportedUpgradeTarget(targetVersion, profile)
        ? {
              policy: LEGACY_UPGRADE_CONTRACT.policy,
              minimumVersion: LEGACY_UPGRADE_CONTRACT.profile.minimumSourceVersion,
          }
        : { policy: 'manual-review', minimumVersion: null }
}

export function getUpgradeCompatibility(
    currentVersion: string,
    targetVersion: string,
    readiness: ReleaseReadiness | null,
): ApplicationUpdate['compatibility'] {
    const source = parseReleaseVersion(currentVersion)
    const target = parseReleaseVersion(targetVersion)
    const minimum = CURRENT_COMPATIBILITY_PROFILE.minimumSourceVersion
    const declarationMatches =
        readiness?.upgrade.policy === LEGACY_UPGRADE_CONTRACT.policy &&
        readiness.upgrade.minimumVersion === LEGACY_UPGRADE_CONTRACT.profile.minimumSourceVersion &&
        parseReleaseVersion(readiness.tag)?.version === target?.version &&
        readiness.channel === target?.channel
    if (
        source?.channel === 'alpha' &&
        isSupportedUpgradeTarget(targetVersion) &&
        compareReleaseVersions(source.version, minimum) < 0 &&
        (readiness === null || declarationMatches)
    ) {
        return {
            status: 'requires-beta1',
            minimumVersion: minimum,
            intermediateVersion: minimum,
        }
    }
    if (
        source &&
        target &&
        declarationMatches &&
        isSupportedUpgradeSource(currentVersion) &&
        isSupportedUpgradeTarget(targetVersion) &&
        isNewerEligibleRelease(source, target)
    ) {
        return { status: 'supported', minimumVersion: minimum, intermediateVersion: null }
    }
    return { status: 'unsupported', minimumVersion: null, intermediateVersion: null }
}
