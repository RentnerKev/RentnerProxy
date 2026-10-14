import type {
    JsonRecord,
    PreviewIdentity,
    PullRequestLifecycle,
} from '../Types/pr-preview.types.ts'

const PREVIEW_SHORT_SHA_LENGTH = 12

export function asRecord(value: unknown, label: string): JsonRecord {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${label} is not an object.`)
    }
    return value as JsonRecord
}

export function asArray(value: unknown, label: string): readonly unknown[] {
    if (!Array.isArray(value)) throw new Error(`${label} is not an array.`)
    return value
}

export function stringValue(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.length === 0 || /[\r\n\0]/u.test(value)) {
        throw new Error(`${label} is invalid.`)
    }
    return value
}

export function nullableString(value: unknown, label: string): string | null {
    if (value === null) return null
    return stringValue(value, label)
}

export function booleanValue(value: unknown, label: string): boolean {
    if (typeof value !== 'boolean') throw new Error(`${label} is invalid.`)
    return value
}

export function nullableBoolean(value: unknown, label: string): boolean | null {
    if (value === null) return null
    return booleanValue(value, label)
}

export function parsePositiveInteger(value: unknown, label = 'Positive integer'): number {
    const normalized = typeof value === 'number' ? String(value) : value
    if (typeof normalized !== 'string' || !/^[1-9][0-9]*$/u.test(normalized)) {
        throw new Error(`${label} is invalid.`)
    }
    const parsed = Number(normalized)
    if (!Number.isSafeInteger(parsed)) throw new Error(`${label} is invalid.`)
    return parsed
}

export function parseNonNegativeInteger(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${label} is invalid.`)
    }
    return value
}

export function validateFullSha(value: unknown, label = 'Git SHA'): string {
    if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) {
        throw new Error(`${label} is invalid.`)
    }
    return value
}

export function parsePullRequestLifecycle(value: unknown): PullRequestLifecycle {
    if (value !== 'open' && value !== 'closed') {
        throw new Error('Pull request state is invalid.')
    }
    return value
}

export function parseTestedShaProof(value: unknown): string {
    if (typeof value !== 'string' || !/^[0-9a-f]{40}\n$/u.test(value)) {
        throw new Error('Tested SHA proof file is invalid.')
    }
    return validateFullSha(value.slice(0, 40), 'Proven tested SHA')
}

export function parsePullRequestNumberProof(value: unknown): number {
    if (typeof value !== 'string' || !/^[1-9][0-9]*\n$/u.test(value)) {
        throw new Error('Pull request number proof file is invalid.')
    }
    return parsePositiveInteger(value.slice(0, -1), 'Proven pull request number')
}

export function validateSha256Digest(value: unknown, label = 'SHA-256 digest'): string {
    if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
        throw new Error(`${label} is invalid.`)
    }
    return value
}

export function validateSha256Hex(value: unknown, label: string): string {
    if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) {
        throw new Error(`${label} is invalid.`)
    }
    return value
}

export function normalizeRepository(value: unknown): string {
    const normalized = stringValue(value, 'Repository').toLowerCase()
    if (!/^[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.-]*$/u.test(normalized)) {
        throw new Error('Repository is invalid.')
    }
    return normalized
}

export function validateRef(value: unknown, label: string): string {
    const ref = stringValue(value, label)
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(ref) || ref.includes('..')) {
        throw new Error(`${label} is invalid.`)
    }
    return ref
}

export function normalizeWorkflowPath(value: unknown): string {
    const rawPath = stringValue(value, 'Workflow path')
    const separatorIndex = rawPath.indexOf('@')
    const path = separatorIndex === -1 ? rawPath : rawPath.slice(0, separatorIndex)
    if (
        !/^\.github\/workflows\/[A-Za-z0-9][A-Za-z0-9._/-]*\.ya?ml$/u.test(path) ||
        path.includes('..') ||
        (separatorIndex !== -1 && rawPath.slice(separatorIndex + 1).length === 0)
    ) {
        throw new Error('Workflow path is invalid.')
    }
    return path
}

export function assertPreviewTag(value: unknown): string {
    const tag = stringValue(value, 'Preview tag')
    if (
        !/^(?:pr-[1-9][0-9]*|pr-[1-9][0-9]*-[0-9a-f]{12})$/u.test(tag) ||
        tag === 'latest' ||
        tag === 'dev' ||
        /^v?[0-9]+\.[0-9]+\.[0-9]+(?:-|$)/u.test(tag)
    ) {
        throw new Error('Preview tag is outside the PR preview channel.')
    }
    return tag
}

export function createPreviewIdentity(
    repositoryValue: unknown,
    pullRequestNumberValue: unknown,
    testedShaValue: unknown,
): PreviewIdentity {
    const repository = normalizeRepository(repositoryValue)
    const pullRequestNumber = parsePositiveInteger(pullRequestNumberValue, 'Pull request number')
    const testedSha = validateFullSha(testedShaValue, 'Tested SHA')
    const shortTestedSha = testedSha.slice(0, PREVIEW_SHORT_SHA_LENGTH)
    const movingTag = assertPreviewTag(`pr-${pullRequestNumber}`)
    const immutableTag = assertPreviewTag(`pr-${pullRequestNumber}-${shortTestedSha}`)
    const image = `ghcr.io/${repository}`

    return {
        image,
        immutableReference: `${image}:${immutableTag}`,
        immutableTag,
        movingReference: `${image}:${movingTag}`,
        movingTag,
        pullRequestNumber,
        repository,
        shortTestedSha,
        testedSha,
    }
}

const previewPublishPlanKeys = [
    'image',
    'immutableReference',
    'immutableTag',
    'movingReference',
    'movingTag',
] as const

export function assertPreviewPublishPlan(
    value: unknown,
    repositoryValue: unknown,
    pullRequestNumberValue: unknown,
    testedShaValue: unknown,
): PreviewIdentity {
    const plan = asRecord(value, 'Preview publish plan')
    const actualKeys = Object.keys(plan).toSorted()
    if (actualKeys.join('\0') !== previewPublishPlanKeys.toSorted().join('\0')) {
        throw new Error('Preview publish plan fields are invalid.')
    }

    const identity = createPreviewIdentity(repositoryValue, pullRequestNumberValue, testedShaValue)
    const expected: Readonly<Record<(typeof previewPublishPlanKeys)[number], string>> = {
        image: identity.image,
        immutableReference: identity.immutableReference,
        immutableTag: identity.immutableTag,
        movingReference: identity.movingReference,
        movingTag: identity.movingTag,
    }
    for (const key of previewPublishPlanKeys) {
        if (stringValue(plan[key], `Preview publish plan ${key}`) !== expected[key]) {
            throw new Error(`Preview publish plan mismatch: ${key}.`)
        }
    }
    return identity
}

export function assertMatchingPreviewDigests(
    sourceDigestValue: unknown,
    immutableDigestValue: unknown,
    movingDigestValue?: unknown,
): string {
    const sourceDigest = validateSha256Digest(sourceDigestValue, 'Source image digest')
    const immutableDigest = validateSha256Digest(immutableDigestValue, 'Immutable preview digest')
    if (immutableDigest !== sourceDigest) {
        throw new Error('Immutable preview tag does not match the source OCI image digest.')
    }
    if (movingDigestValue !== undefined) {
        const movingDigest = validateSha256Digest(movingDigestValue, 'Moving preview digest')
        if (movingDigest !== sourceDigest) {
            throw new Error('Moving preview tag does not match the source OCI image digest.')
        }
    }
    return sourceDigest
}
