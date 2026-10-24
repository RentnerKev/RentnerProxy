import { join } from 'node:path'
import { isReleaseMetadataCompatible } from '../../../web/src/lib/ApplicationVersion/releaseMetadata.ts'

import type { ReleaseReadiness } from '../../../web/src/lib/ApplicationVersion/Types/release-readiness.types.ts'
import type {
    ReleaseReadinessInput,
    ValidatedReleaseReadinessInput,
} from './Types/release-readiness.types.ts'

export function parseReleaseReadinessInput(
    input: ReleaseReadinessInput,
): ValidatedReleaseReadinessInput {
    if (
        input.repository.toLowerCase() !== 'rentnerkev/rentnerproxy' ||
        input.image !== 'ghcr.io/rentnerkev/rentnerproxy'
    ) {
        throw new Error('Readiness is restricted to the official repository and image')
    }
    const version =
        /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:alpha|beta)(?:\.[0-9A-Za-z-]+)*))?$/.exec(
            input.tag,
        )
    if (!version || input.tag.length > 128) throw new Error('Invalid official release tag')
    const prerelease = version[4]?.split('.') ?? []
    if (prerelease.some((part) => /^0[0-9]+$/.test(part))) {
        throw new Error('Numeric prerelease identifiers cannot have leading zeroes')
    }
    const channel = (prerelease[0] ?? 'stable') as ReleaseReadiness['channel']
    if (
        input.channel !== channel ||
        (input.prerelease !== 'true' && input.prerelease !== 'false') ||
        !isReleaseMetadataCompatible(channel, input.prerelease === 'true')
    ) {
        throw new Error('Release channel and prerelease state must match the tag')
    }
    if (!/^[1-9][0-9]*$/.test(input.releaseId) || !Number.isSafeInteger(Number(input.releaseId))) {
        throw new Error('Invalid release ID')
    }
    if (
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(input.publishedAt) ||
        !Number.isFinite(Date.parse(input.publishedAt)) ||
        new Date(input.publishedAt).toISOString() !== input.publishedAt.replace('Z', '.000Z')
    ) {
        throw new Error('Invalid original publication timestamp')
    }
    if (!/^[0-9a-f]{40}$/.test(input.revision)) throw new Error('Invalid source revision')
    if (!/^sha256:[0-9a-f]{64}$/.test(input.digest))
        throw new Error('Invalid assessed image digest')
    if (input.platforms !== 'linux/amd64') throw new Error('Unsupported assessed image platforms')

    // Only the tested major-one beta/stable update family may opt into the beta-one policy.
    // Within 1.0.0, SemVer beta.2 is the first supported target; beta.2.* sorts after it.
    const betaAtLeastTwo =
        prerelease[0] === 'beta' &&
        prerelease[1] !== undefined &&
        (!/^[0-9]+$/.test(prerelease[1]) || BigInt(prerelease[1]) >= 2n)
    const automaticUpgrade =
        version[1] === '1' &&
        channel !== 'alpha' &&
        (version[2] !== '0' || version[3] !== '0' || channel === 'stable' || betaAtLeastTwo)

    return {
        releaseId: Number(input.releaseId),
        tag: input.tag,
        channel: channel as ReleaseReadiness['channel'],
        publishedAt: input.publishedAt,
        revision: input.revision,
        digest: input.digest,
        automaticUpgrade,
    }
}

export function buildReleaseReadiness(input: ReleaseReadinessInput): ReleaseReadiness {
    const validated = parseReleaseReadinessInput(input)
    return {
        schemaVersion: 1,
        releaseId: validated.releaseId,
        tag: validated.tag,
        channel: validated.channel,
        publishedAt: validated.publishedAt,
        revision: validated.revision,
        image: {
            repository: 'ghcr.io/rentnerkev/rentnerproxy',
            digest: validated.digest,
            platforms: ['linux/amd64'],
        },
        upgrade: validated.automaticUpgrade
            ? { policy: 'beta1-appliance-v1', minimumVersion: 'v1.0.0-beta.1' }
            : { policy: 'manual-review', minimumVersion: null },
    }
}

if (import.meta.main) {
    const env = process.env
    const readiness = buildReleaseReadiness({
        repository: env.GITHUB_REPOSITORY ?? '',
        releaseId: env.RELEASE_ID ?? '',
        tag: env.RELEASE_TAG ?? '',
        channel: env.RELEASE_CHANNEL ?? '',
        prerelease: env.RELEASE_PRERELEASE ?? '',
        publishedAt: env.RELEASE_PUBLISHED_AT ?? '',
        revision: env.RELEASE_REVISION ?? '',
        image: env.RELEASE_IMAGE ?? '',
        digest: env.RELEASE_DIGEST ?? '',
        platforms: env.RELEASE_PLATFORMS ?? '',
    })
    if (!env.RUNNER_TEMP) throw new Error('Runner temporary directory is required')
    await Bun.write(
        join(env.RUNNER_TEMP, 'rentnerproxy-release/rentnerproxy-update.json'),
        JSON.stringify(readiness, null, 4) + '\n',
    )
}
