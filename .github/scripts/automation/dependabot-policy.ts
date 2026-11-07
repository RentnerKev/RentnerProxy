import { YAML } from 'bun'
import type {
    DependabotEligibility,
    DependabotEligibilityInput,
} from './Types/dependabot-policy.types.ts'

function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Missing structured API or metadata object')
    return value as Record<string, unknown>
}

function text(value: unknown): string {
    if (typeof value !== 'string' || !value) throw new Error('Missing API or metadata string')
    return value
}

function bot(value: unknown): boolean {
    const user = object(value)
    return user.login === 'dependabot[bot]' && user.id === 49699333 && user.type === 'Bot'
}

function stableVersion(value: string): [number, number, number] {
    const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value)
    if (!match) throw new Error('Unknown, digest-only or prerelease dependency version')
    const parts = match.slice(1).map(Number)
    if (!parts.every(Number.isSafeInteger)) throw new Error('Invalid dependency version')
    return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function validateUpdate(previous: string, next: string, updateType: unknown): void {
    const [oldMajor, oldMinor, oldPatch] = stableVersion(previous)
    const [newMajor, newMinor, newPatch] = stableVersion(next)
    if (
        oldMajor !== newMajor ||
        newMinor < oldMinor ||
        (newMinor === oldMinor && newPatch <= oldPatch) ||
        (oldMajor === 0 && oldMinor !== newMinor)
    )
        throw new Error('Major, breaking pre-1.0, downgrade or unchanged dependency update')
    const expected = newMinor === oldMinor ? 'semver-patch' : 'semver-minor'
    if (updateType !== `version-update:${expected}`)
        throw new Error('Dependency update type is unknown or inconsistent with versions')
}

function validateMetadata(message: string): void {
    const normalized = message.replace(/\r\n/g, '\n')
    const trailers = [...normalized.matchAll(/^---\n([\s\S]*?)^\.\.\.(?:\n|$)/gm)]
    if (trailers.length !== 1) throw new Error('Missing or ambiguous Dependabot metadata trailer')
    const trailer = trailers[0]
    if (!trailer) throw new Error('Missing Dependabot metadata trailer')
    let metadata: unknown
    try {
        metadata = YAML.parse(text(trailer[1]))
    } catch {
        throw new Error('Invalid Dependabot metadata YAML')
    }
    const dependencies = object(metadata)['updated-dependencies']
    if (!Array.isArray(dependencies) || dependencies.length === 0)
        throw new Error('Missing dependency update metadata')
    const prose = normalized.slice(0, trailer.index)
    const updates = [...prose.matchAll(/^Updates `(\S+)` from `?(\S+?)`? to `?(\S+?)`?$/gm)]
    if (updates.length) {
        if (updates.length !== dependencies.length)
            throw new Error('Grouped dependency version metadata is incomplete')
        for (let index = 0; index < dependencies.length; index++) {
            const dependency = object(dependencies[index])
            const update = updates[index]
            if (!update) throw new Error('Missing grouped dependency versions')
            if (
                text(dependency['dependency-name']) !== update[1] ||
                text(dependency['dependency-version']) !== update[3]
            )
                throw new Error('Grouped dependency names or versions are inconsistent')
            validateUpdate(text(update[2]), text(update[3]), dependency['update-type'])
        }
    } else {
        const bumps = [...prose.matchAll(/^Bumps .+ from `?(\S+?)`? to `?(\S+?)`?\.$/gm)]
        if (dependencies.length !== 1 || bumps.length !== 1)
            throw new Error('Missing unambiguous previous and next dependency versions')
        const bump = bumps[0]
        if (!bump) throw new Error('Missing dependency versions')
        const dependency = object(dependencies[0])
        text(dependency['dependency-name'])
        if (text(dependency['dependency-version']) !== bump[2])
            throw new Error('Dependency version is inconsistent with signed commit prose')
        validateUpdate(text(bump[1]), text(bump[2]), dependency['update-type'])
    }
}

function validateCommit(value: unknown, trustedMergeBotLogin?: string): boolean {
    const entry = object(value)
    text(entry.sha)
    if (!Array.isArray(entry.parents) || entry.parents.length === 0)
        throw new Error('Missing commit parents')
    const commit = object(entry.commit)
    const author = object(commit.author)
    const committer = object(commit.committer)
    const account = object(entry.committer)
    const githubCommitter =
        account.login === 'web-flow' &&
        account.id === 19864447 &&
        committer.name === 'GitHub' &&
        committer.email === 'noreply@github.com'
    const botCommitter =
        bot(account) &&
        committer.name === 'dependabot[bot]' &&
        committer.email === '49699333+dependabot[bot]@users.noreply.github.com'
    const verification = object(commit.verification)
    if (verification.verified !== true || verification.reason !== 'valid')
        throw new Error('Commit signature is not verified')
    if (entry.parents.length > 1) {
        const mergeAuthor = object(entry.author)
        const trustedBot =
            trustedMergeBotLogin &&
            /^[a-z0-9-]+\[bot\]$/.test(trustedMergeBotLogin) &&
            mergeAuthor.login === trustedMergeBotLogin &&
            mergeAuthor.type === 'Bot' &&
            typeof mergeAuthor.id === 'number' &&
            Number.isSafeInteger(mergeAuthor.id) &&
            mergeAuthor.id > 0
        const trustedCommitter =
            account.login === trustedMergeBotLogin &&
            account.id === mergeAuthor.id &&
            account.type === 'Bot'
        if (entry.parents.length !== 2 || !trustedBot || (!githubCommitter && !trustedCommitter))
            throw new Error('Merge commit is not a verified trusted branch-update app commit')
        return false
    }
    if (
        !bot(entry.author) ||
        author.name !== 'dependabot[bot]' ||
        author.email !== '49699333+dependabot[bot]@users.noreply.github.com' ||
        (!githubCommitter && !botCommitter)
    )
        throw new Error('Nonmerge commit is not a verified authentic Dependabot commit')
    validateMetadata(text(commit.message))
    return true
}

function dependencyPath(filename: string): boolean {
    return (
        [
            'package.json',
            'bun.lock',
            'core/Cargo.toml',
            'core/Cargo.lock',
            'core/caddy-modules/responsecache/go.mod',
            'core/caddy-modules/responsecache/go.sum',
            'docker/production/Dockerfile',
            'docker/proxy-runtime/Dockerfile',
            'docker/web/Dockerfile',
            'docker-compose.yml',
        ].includes(filename) || /^\.github\/workflows\/[a-zA-Z0-9_-]+\.ya?ml$/.test(filename)
    )
}

export function evaluateDependabotEligibility({
    pullRequest,
    commits,
    files,
    repository,
    trustedMergeBotLogin,
}: DependabotEligibilityInput): DependabotEligibility {
    try {
        const pr = object(pullRequest)
        const base = object(pr.base)
        const head = object(pr.head)
        if (
            pr.state !== 'open' ||
            pr.draft !== false ||
            !bot(pr.user) ||
            base.ref !== 'main' ||
            text(object(base.repo).full_name).toLowerCase() !== repository.toLowerCase() ||
            text(object(head.repo).full_name).toLowerCase() !== repository.toLowerCase() ||
            !text(head.ref).startsWith('dependabot/')
        )
            throw new Error('PR is not an open same-repository Dependabot update targeting main')
        if (
            /^\w+(?:\([^\n]*\))?!:/.test(text(pr.title)) ||
            (Array.isArray(pr.labels) &&
                pr.labels.some((label: unknown) =>
                    /breaking|major/i.test(text(object(label).name)),
                ))
        )
            throw new Error('PR is explicitly marked as a breaking update')
        if (
            commits.length === 0 ||
            files.length === 0 ||
            pr.commits !== commits.length ||
            pr.changed_files !== files.length ||
            !commits.some((commit) => object(commit).sha === text(head.sha)) ||
            new Set(commits.map((commit) => text(object(commit).sha))).size !== commits.length
        )
            throw new Error('Current commit or changed-file API coverage is incomplete')
        let dependencyCommits = 0
        for (const commit of commits)
            if (validateCommit(commit, trustedMergeBotLogin)) dependencyCommits++
        if (dependencyCommits === 0) throw new Error('No authenticated dependency update commit')
        for (const value of files) {
            const file = object(value)
            if (
                file.status !== 'modified' ||
                file.previous_filename !== undefined ||
                !dependencyPath(text(file.filename))
            )
                throw new Error('PR changes files outside the dependency-owned allowlist')
        }
        return { eligible: true, reason: 'Verified dependency-only stable minor or patch update' }
    } catch (error) {
        return {
            eligible: false,
            reason: error instanceof Error ? error.message : 'Invalid dependency update input',
        }
    }
}
