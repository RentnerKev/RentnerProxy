import { describe, expect, test } from 'bun:test'
import { evaluateDependabotEligibility } from '../../../../../.github/scripts/automation/dependabot-policy.ts'

const bot = { login: 'dependabot[bot]', id: 49699333, type: 'Bot' }

function message(previous = '1.2.3', next = '1.2.4', type = 'patch'): string {
    return `chore(deps): bump example\n\nBumps example from ${previous} to ${next}.\n\n---\nupdated-dependencies:\n- dependency-name: example\n  dependency-version: ${next}\n  update-type: version-update:semver-${type}\n...\n\nSigned-off-by: dependabot[bot] <support@github.com>`
}

function fixture(commitMessage = message()) {
    return {
        repository: 'RentnerProxy/RentnerProxy',
        pullRequest: {
            state: 'open',
            draft: false,
            user: { ...bot },
            title: 'chore(deps): update dependencies',
            labels: [{ name: 'dependencies' }],
            base: { ref: 'main', repo: { full_name: 'RentnerProxy/RentnerProxy' } },
            head: {
                ref: 'dependabot/bun/bun-minor-and-patch',
                sha: 'abc',
                repo: { full_name: 'RentnerProxy/RentnerProxy' },
            },
            commits: 1,
            changed_files: 2,
        },
        commits: [
            {
                sha: 'abc',
                parents: [{ sha: 'base' }],
                author: { ...bot },
                committer: { login: 'web-flow', id: 19864447, type: 'User' },
                commit: {
                    author: {
                        name: 'dependabot[bot]',
                        email: '49699333+dependabot[bot]@users.noreply.github.com',
                    },
                    committer: { name: 'GitHub', email: 'noreply@github.com' },
                    verification: { verified: true, reason: 'valid' },
                    message: commitMessage,
                },
            },
        ] satisfies [unknown, ...unknown[]],
        files: [
            { filename: 'package.json', status: 'modified' },
            { filename: 'bun.lock', status: 'modified' },
        ] satisfies [unknown, ...unknown[]],
    }
}

describe('Dependabot automatic merge eligibility', () => {
    test.each([
        ['1.2.3', '1.2.4', 'patch'],
        ['1.2.3', '1.3.0', 'minor'],
        ['0.2.3', '0.2.4', 'patch'],
        ['v2.1.0', 'v2.1.1', 'patch'],
    ])('accepts stable %s to %s %s updates', (previous, next, type) => {
        expect(evaluateDependabotEligibility(fixture(message(previous, next, type))).eligible).toBe(
            true,
        )
    })

    test.each([
        ['1.2.3', '2.0.0', 'major'],
        ['1.2.3', '1.1.9', 'patch'],
        ['1.2.3', '1.2.2', 'patch'],
        ['1.2.3', '1.2.3', 'patch'],
        ['0.2.3', '0.3.0', 'minor'],
        ['1.2.3', '1.3.0-beta.1', 'minor'],
        ['1.2.3-beta.1', '1.2.3', 'patch'],
        ['09027f8', '8a4e90c', 'patch'],
        ['1.2.3', '1.3.0', 'patch'],
        ['1.2.3', '1.2.4', 'unknown'],
        ['1.2.3', '1.2', 'patch'],
    ])('rejects unsafe or unknown %s to %s %s updates', (previous, next, type) => {
        expect(evaluateDependabotEligibility(fixture(message(previous, next, type))).eligible).toBe(
            false,
        )
    })

    test('checks every dependency in grouped signed metadata', () => {
        const grouped = `chore(deps): group\n\nUpdates \`example\` from 1.2.3 to 1.2.4\nUpdates \`other\` from 2.0.0 to 2.1.0\n\n---\nupdated-dependencies:\n- dependency-name: example\n  dependency-version: 1.2.4\n  update-type: version-update:semver-patch\n- dependency-name: other\n  dependency-version: 2.1.0\n  update-type: version-update:semver-minor\n...\n`
        expect(evaluateDependabotEligibility(fixture(grouped)).eligible).toBe(true)
        expect(
            evaluateDependabotEligibility(fixture(grouped.replaceAll('other', 'example'))).eligible,
        ).toBe(true)
        expect(
            evaluateDependabotEligibility(
                fixture(
                    grouped.replaceAll('2.1.0', '3.0.0').replace('semver-minor', 'semver-major'),
                ),
            ).eligible,
        ).toBe(false)
        expect(
            evaluateDependabotEligibility(
                fixture(grouped.replace('Updates `other` from 2.0.0 to 2.1.0\n', '')),
            ).eligible,
        ).toBe(false)
        expect(
            evaluateDependabotEligibility(
                fixture(grouped.replace('dependency-name: other', 'dependency-name: absent')),
            ).eligible,
        ).toBe(false)
    })

    test.each([
        'Bumps dependencies.',
        message() + '\n---\nupdated-dependencies: []\n...\n',
        message().replace('updated-dependencies:', 'unrelated:'),
        message().replace('dependency-version: 1.2.4', 'dependency-version: 1.2.5'),
    ])('rejects incomplete, malformed or inconsistent signed metadata', (commitMessage) => {
        expect(evaluateDependabotEligibility(fixture(commitMessage)).eligible).toBe(false)
    })

    test('rejects PR #359 digest-only update despite semver-patch classification', () => {
        const digest = `chore(deps): bump library/rust\n\nUpdates \`library/rust\` from \`09027f8\` to \`8a4e90c\`\nUpdates \`library/rust\` from \`09027f8\` to \`8a4e90c\`\n\n---\nupdated-dependencies:\n- dependency-name: library/rust\n  dependency-version: 1.99.1-trixie\n  update-type: version-update:semver-patch\n- dependency-name: library/rust\n  dependency-version: 1.99.1-trixie\n  update-type: version-update:semver-patch\n...\n`
        expect(evaluateDependabotEligibility(fixture(digest)).eligible).toBe(false)
    })

    test('allows branch-update merge commits and authenticates every nonmerge commit', () => {
        const input = fixture()
        const merge = {
            ...structuredClone(input.commits[0]),
            sha: 'merge',
            parents: [{ sha: 'abc' }, { sha: 'main' }],
            author: { login: 'branch-updater[bot]', id: 12345, type: 'Bot' },
        }
        input.commits.push(merge)
        input.pullRequest.head.sha = 'merge'
        input.pullRequest.commits = 2
        const withTrustedApp = { ...input, trustedMergeBotLogin: 'branch-updater[bot]' }
        expect(evaluateDependabotEligibility(withTrustedApp).eligible).toBe(true)
        expect(evaluateDependabotEligibility(input).eligible).toBe(false)
        merge.author.login = 'human'
        expect(evaluateDependabotEligibility(withTrustedApp).eligible).toBe(false)
        merge.author.login = 'branch-updater[bot]'
        merge.commit.verification.verified = false
        expect(evaluateDependabotEligibility(withTrustedApp).eligible).toBe(false)
        merge.commit.verification.verified = true
        merge.parents.push({ sha: 'third' })
        expect(evaluateDependabotEligibility(withTrustedApp).eligible).toBe(false)
        merge.parents.pop()
        input.commits[0].author.login = 'human'
        expect(evaluateDependabotEligibility(withTrustedApp).eligible).toBe(false)
    })

    test('compares repository identity without case sensitivity', () => {
        expect(
            evaluateDependabotEligibility({ ...fixture(), repository: 'rentnerproxy/rentnerproxy' })
                .eligible,
        ).toBe(true)
    })

    test('accepts verified direct bot commits and rejects merge-only histories', () => {
        const input = fixture()
        input.commits[0].committer = { ...bot }
        input.commits[0].commit.committer = { ...input.commits[0].commit.author }
        expect(evaluateDependabotEligibility(input).eligible).toBe(true)
        input.commits[0].parents.push({ sha: 'main' })
        expect(evaluateDependabotEligibility(input).eligible).toBe(false)
    })

    test('rejects duplicate commits, empty coverage and renamed dependency files', () => {
        const input = fixture()
        expect(evaluateDependabotEligibility({ ...input, commits: [] }).eligible).toBe(false)
        expect(evaluateDependabotEligibility({ ...input, files: [] }).eligible).toBe(false)
        expect(
            evaluateDependabotEligibility({
                ...input,
                pullRequest: { ...input.pullRequest, commits: 2 },
                commits: [input.commits[0], input.commits[0]],
            }).eligible,
        ).toBe(false)
        expect(
            evaluateDependabotEligibility({
                ...input,
                files: [
                    { ...input.files[0], previous_filename: 'web/src/server.ts' },
                    input.files[1],
                ],
            }).eligible,
        ).toBe(false)
    })

    test.each([
        (input: ReturnType<typeof fixture>) => {
            input.pullRequest.user.id = 123
        },
        (input: ReturnType<typeof fixture>) => {
            input.pullRequest.draft = true
        },
        (input: ReturnType<typeof fixture>) => {
            input.pullRequest.base.ref = 'release'
        },
        (input: ReturnType<typeof fixture>) => {
            input.pullRequest.head.repo.full_name = 'attacker/RentnerProxy'
        },
        (input: ReturnType<typeof fixture>) => {
            input.pullRequest.head.ref = 'human/update'
        },
        (input: ReturnType<typeof fixture>) => {
            input.pullRequest.head.sha = 'stale'
        },
        (input: ReturnType<typeof fixture>) => {
            input.pullRequest.commits = 2
        },
        (input: ReturnType<typeof fixture>) => {
            input.pullRequest.changed_files = 3
        },
        (input: ReturnType<typeof fixture>) => {
            input.pullRequest.title = 'chore(deps)!: breaking'
        },
        (input: ReturnType<typeof fixture>) => {
            input.pullRequest.labels.push({ name: 'breaking-change' })
        },
        (input: ReturnType<typeof fixture>) => {
            input.commits[0].commit.verification.verified = false
        },
        (input: ReturnType<typeof fixture>) => {
            input.commits[0].commit.verification.reason = 'unsigned'
        },
        (input: ReturnType<typeof fixture>) => {
            input.commits[0].committer.login = 'human'
        },
        (input: ReturnType<typeof fixture>) => {
            input.commits[0].commit.author.email = 'human@example.com'
        },
        (input: ReturnType<typeof fixture>) => {
            input.commits[0].parents = []
        },
        (input: ReturnType<typeof fixture>) => {
            input.files[0].filename = 'web/src/server.ts'
        },
        (input: ReturnType<typeof fixture>) => {
            input.files[0].filename = '../package.json'
        },
        (input: ReturnType<typeof fixture>) => {
            input.files[0].status = 'renamed'
        },
        (input: ReturnType<typeof fixture>) => {
            input.files[0].status = 'added'
        },
        (input: ReturnType<typeof fixture>) => {
            input.files[0].status = 'removed'
        },
    ])('rejects unauthenticated, incomplete or nondependency changes', (mutate) => {
        const input = fixture()
        mutate(input)
        expect(evaluateDependabotEligibility(input).eligible).toBe(false)
    })

    test('fails closed for malformed API objects', () => {
        for (const pullRequest of [null, {}, [], { state: 'open' }]) {
            expect(evaluateDependabotEligibility({ ...fixture(), pullRequest }).eligible).toBe(
                false,
            )
        }
    })
})
