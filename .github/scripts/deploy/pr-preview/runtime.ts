import type { PreviewIdentity, ExpectedPullRequest } from '../Types/pr-preview.types.ts'
import { appendFile } from 'node:fs/promises'
import {
    stringValue,
    parsePositiveInteger,
    validateFullSha,
    normalizeRepository,
    validateRef,
} from './validation.ts'

export function environment(name: string): string {
    return stringValue(process.env[name], name)
}

export function environmentPositiveInteger(name: string, fallback?: number): number {
    const value = process.env[name]
    if ((value === undefined || value === '') && fallback !== undefined) return fallback
    return parsePositiveInteger(value, name)
}

export function expectedPullRequestFromEnvironment(): ExpectedPullRequest {
    return {
        baseRef: validateRef(environment('PR_BASE_REF'), 'PR base ref'),
        baseRepository: normalizeRepository(environment('REPOSITORY')),
        baseSha: validateFullSha(environment('PR_BASE_SHA'), 'PR base SHA'),
        headRepository: normalizeRepository(environment('PR_HEAD_REPOSITORY')),
        headSha: validateFullSha(environment('PR_HEAD_SHA'), 'PR head SHA'),
        number: parsePositiveInteger(environment('PR_NUMBER'), 'PR number'),
        testedSha: validateFullSha(environment('TESTED_SHA'), 'Tested SHA'),
    }
}

export async function writeOutputs(
    values: Readonly<Record<string, string | number>>,
): Promise<void> {
    const outputPath = environment('GITHUB_OUTPUT')
    const lines = Object.entries(values).map(([key, value]) => {
        if (!/^[a-z][a-z0-9_]*$/u.test(key)) throw new Error('GitHub output key is invalid.')
        const serialized = String(value)
        if (/[\r\n\0]/u.test(serialized)) throw new Error('GitHub output value is invalid.')
        return `${key}=${serialized}`
    })
    await appendFile(outputPath, `${lines.join('\n')}\n`, 'utf8')
}

export function previewOutputs(
    identity: PreviewIdentity,
    expected: ExpectedPullRequest,
): Readonly<Record<string, string | number>> {
    return {
        base_ref: expected.baseRef,
        base_sha: expected.baseSha,
        head_repository: expected.headRepository,
        head_sha: expected.headSha,
        image: identity.image,
        immutable_reference: identity.immutableReference,
        immutable_tag: identity.immutableTag,
        moving_reference: identity.movingReference,
        moving_tag: identity.movingTag,
        pr_number: identity.pullRequestNumber,
        repository: identity.repository,
        short_tested_sha: identity.shortTestedSha,
        tested_sha: identity.testedSha,
    }
}
