import { describe, expect, test } from 'bun:test'

import { generateReleaseNotes, GitHubReleaseClient } from '../../../scripts/generate-release-notes'
import {
    filterIssues,
    findMatchingMilestone,
    findPreviousRelease,
    renderReleaseNotes,
    validateReleaseTag,
} from '../../../scripts/release-notes'
import type { GitHubIssue, GitHubRelease, ReleaseNotesConfig } from '../../../scripts/release-notes'

const config: ReleaseNotesConfig = {
    excludedLabels: ['duplicate', 'invalid', 'wontfix', 'no-changelog', 'not-planned'],
    highlightLabels: ['release-highlight', 'highlight'],
    categories: [
        { title: '💥 Breaking Changes', labels: ['breaking-change'] },
        { title: '🔒 Security', labels: ['security'] },
        { title: '✨ New Features', labels: ['enhancement'] },
        { title: '🐛 Bug Fixes', labels: ['bug'] },
        { title: '📦 Dependencies', labels: ['dependencies'] },
        { title: '🛠 Other Changes', labels: [] },
    ],
}

function release(overrides: Partial<GitHubRelease> = {}): GitHubRelease {
    return {
        id: 1,
        tag_name: 'v1.0.0',
        published_at: '2026-01-01T00:00:00Z',
        prerelease: false,
        draft: false,
        ...overrides,
    }
}

function issue(number: number, overrides: Partial<GitHubIssue> = {}): GitHubIssue {
    return {
        number,
        title: 'Issue ' + number,
        closed_at: '2026-01-' + String(number).padStart(2, '0') + 'T00:00:00Z',
        labels: [],
        user: { login: 'user-' + number, type: 'User' },
        ...overrides,
    }
}

function documentInput(overrides: Partial<Parameters<typeof renderReleaseNotes>[0]> = {}) {
    return {
        repository: 'RentnerKev/RentnerProxy',
        tagName: 'v1.2.0',
        channel: 'stable' as const,
        publishedAt: '2026-09-02T12:00:00Z',
        image: 'ghcr.io/rentnerkev/rentnerproxy',
        bannerAssetName: 'release-banner.png',
        issues: [] as GitHubIssue[],
        config,
        initialRelease: false,
        previousTag: 'v1.1.0',
        ...overrides,
    }
}

describe('release tag validation', () => {
    test('accepts stable and prerelease SemVer tags with a leading v', () => {
        expect(() => validateReleaseTag('v1.2.3', false)).not.toThrow()
        expect(() => validateReleaseTag('v1.2.3-beta.1', true)).not.toThrow()
        expect(() => validateReleaseTag('v0.0.0-rc.10', true)).not.toThrow()
    })

    test('rejects channel contradictions and Docker-incompatible SemVer forms', () => {
        expect(() => validateReleaseTag('v1.2.3', true)).toThrow()
        expect(() => validateReleaseTag('v1.2.3-rc.1', false)).toThrow()
        expect(() => validateReleaseTag('v1.2.3+build.4', false)).toThrow()
        expect(() => validateReleaseTag('v1.2.3-rc.01', true)).toThrow()
        expect(() => validateReleaseTag('../v1.2.3', false)).toThrow()
    })
})

describe('release history selection', () => {
    test('treats a release without an earlier publication as initial', () => {
        expect(
            findPreviousRelease([], {
                id: 10,
                tagName: 'v1.0.0',
                prerelease: false,
                publishedAt: '2026-04-01T00:00:00Z',
            }),
        ).toBeUndefined()
    })

    test('uses the previous stable release for the first prerelease', () => {
        const previous = findPreviousRelease(
            [
                release({ id: 1, tag_name: 'v1.0.0', published_at: '2026-01-01T00:00:00Z' }),
                release({
                    id: 2,
                    tag_name: 'v0.9.0-rc.1',
                    prerelease: true,
                    published_at: '2025-12-01T00:00:00Z',
                }),
            ],
            {
                id: 3,
                tagName: 'v1.1.0-beta.1',
                prerelease: true,
                publishedAt: '2026-02-01T00:00:00Z',
            },
        )
        expect(previous?.tag_name).toBe('v1.0.0')
    })

    test('uses the immediately previous prerelease for a later prerelease', () => {
        const previous = findPreviousRelease(
            [
                release({ id: 1, tag_name: 'v1.0.0', published_at: '2026-01-01T00:00:00Z' }),
                release({
                    id: 2,
                    tag_name: 'v1.1.0-beta.1',
                    prerelease: true,
                    published_at: '2026-02-01T00:00:00Z',
                }),
            ],
            {
                id: 3,
                tagName: 'v1.1.0-beta.2',
                prerelease: true,
                publishedAt: '2026-02-10T00:00:00Z',
            },
        )
        expect(previous?.tag_name).toBe('v1.1.0-beta.1')
    })

    test('ignores intervening prereleases for a stable release', () => {
        const previous = findPreviousRelease(
            [
                release({ id: 1, tag_name: 'v1.0.0', published_at: '2026-01-01T00:00:00Z' }),
                release({
                    id: 2,
                    tag_name: 'v1.1.0-beta.1',
                    prerelease: true,
                    published_at: '2026-02-01T00:00:00Z',
                }),
                release({
                    id: 3,
                    tag_name: 'v1.1.0-rc.1',
                    prerelease: true,
                    published_at: '2026-02-10T00:00:00Z',
                }),
            ],
            {
                id: 4,
                tagName: 'v1.1.0',
                prerelease: false,
                publishedAt: '2026-03-01T00:00:00Z',
            },
        )
        expect(previous?.tag_name).toBe('v1.0.0')
    })
})

describe('milestone and issue selection', () => {
    test('prefers an exact milestone and supports a normalized v prefix', () => {
        expect(
            findMatchingMilestone(
                [
                    { number: 1, title: '1.2.0' },
                    { number: 2, title: 'v1.2.0' },
                ],
                'v1.2.0',
            )?.number,
        ).toBe(2)
        expect(findMatchingMilestone([{ number: 1, title: '1.2.0' }], 'v1.2.0')?.number).toBe(1)
        expect(findMatchingMilestone([{ number: 1, title: 'v1.3.0' }], 'v1.2.0')).toBeUndefined()
    })

    test('excludes PRs, not-planned and excluded-label issues and deduplicates pages', () => {
        const selected = filterIssues(
            [
                issue(1, { labels: ['bug'] }),
                issue(1, { labels: ['enhancement'] }),
                issue(2, { pull_request: {}, labels: ['bug'] }),
                issue(3, { state_reason: 'not_planned', labels: ['bug'] }),
                issue(4, { labels: [{ name: 'Duplicate' }] }),
                issue(5, { labels: ['no-changelog'] }),
                issue(6, { closed_at: '2026-01-11T00:00:00Z', labels: ['bug'] }),
                issue(7, { closed_at: '2026-01-20T00:00:00Z', labels: ['bug'] }),
            ],
            config,
            {
                previousPublishedAt: '2026-01-05T00:00:00Z',
                publishedAt: '2026-01-15T00:00:00Z',
            },
        )
        expect(selected.map((entry) => entry.number)).toEqual([6])
    })

    test('keeps milestone results stable by enforcing the release publication cutoff', () => {
        const selected = filterIssues(
            [issue(1, { closed_at: '2027-01-01T00:00:00Z', labels: ['bug'] })],
            config,
            { publishedAt: '2026-01-15T00:00:00Z' },
        )
        expect(selected).toHaveLength(0)
    })
})

describe('release note rendering', () => {
    test('applies category precedence once and omits empty categories', () => {
        const rendered = renderReleaseNotes(
            documentInput({
                issues: [issue(1, { labels: ['bug', 'enhancement'] })],
            }),
        )
        expect(rendered.body).toContain('## ✨ New Features')
        expect(rendered.body).not.toContain('## 🐛 Bug Fixes')
        expect(rendered.body.match(/\[#1\]/g)).toHaveLength(1)
    })

    test('limits highlights to five while keeping every issue in one category', () => {
        const issues = Array.from({ length: 7 }, (_, index) =>
            issue(index + 1, { labels: ['highlight', 'enhancement'] }),
        )
        const body = renderReleaseNotes(documentInput({ issues })).body
        const highlightSection = body.split('## 🌟 Highlights')[1]?.split('## ✨ New Features')[0]
        expect(highlightSection?.match(/\[#[0-9]+\]/g)).toHaveLength(5)
        expect(body.match(/## ✨ New Features/g)).toHaveLength(1)
    })

    test('renders an initial no-change release without an invalid compare range', () => {
        const initialInput = documentInput({ initialRelease: true })
        Reflect.deleteProperty(initialInput, 'previousTag')
        const rendered = renderReleaseNotes(initialInput)
        expect(rendered.body).toContain('## 📝 Initial Release')
        expect(rendered.body).toContain('No tracked issues were completed')
        expect(rendered.body).toContain('/commits/v1.2.0')
        expect(rendered.body).not.toContain('/compare/')
    })

    test('escapes Markdown and HTML-like issue titles and collapses newlines', () => {
        const backtick = String.fromCharCode(96)
        const rendered = renderReleaseNotes(
            documentInput({
                issues: [
                    issue(1, {
                        title:
                            'Fix [link] *bold* ' +
                            backtick +
                            'code' +
                            backtick +
                            '\n<script>| value',
                        labels: ['bug'],
                    }),
                ],
            }),
        )
        const issueLine = rendered.body.split('\n').find((line) => line.includes('[#1]'))
        expect(issueLine).toContain(
            'Fix \\[link\\] \\*bold\\* \\' +
                backtick +
                'code\\' +
                backtick +
                ' \\<script\\>\\| value',
        )
        expect(issueLine).not.toContain('\n')
        expect(issueLine).not.toContain('<script>')
    })

    test('deduplicates contributors and excludes bots', () => {
        const body = renderReleaseNotes(
            documentInput({
                issues: [
                    issue(1, { user: { login: 'Alice', type: 'User' } }),
                    issue(2, { user: { login: 'alice', type: 'User' } }),
                    issue(3, { user: { login: 'dependabot[bot]', type: 'Bot' } }),
                ],
            }),
        ).body
        expect(body.match(/https:\/\/github\.com\/alice/gi)).toHaveLength(1)
        expect(body).not.toContain('dependabot')
    })

    test('puts the banner first and renders the correct stable and dev channels', () => {
        const stable = renderReleaseNotes(documentInput()).body
        const dev = renderReleaseNotes(
            documentInput({
                tagName: 'v1.2.0-beta.1',
                channel: 'dev',
                previousTag: 'v1.2.0-alpha.1',
            }),
        ).body
        expect(stable.startsWith('![RentnerProxy Release](')).toBeTrue()
        expect(stable).toContain('ghcr.io/rentnerkev/rentnerproxy:latest')
        expect(stable).not.toContain('ghcr.io/rentnerkev/rentnerproxy:dev')
        expect(dev.startsWith('![RentnerProxy Development Release](')).toBeTrue()
        expect(dev).toContain('ghcr.io/rentnerkev/rentnerproxy:dev')
        expect(dev).not.toContain('ghcr.io/rentnerkev/rentnerproxy:latest')
        expect(dev).toContain('Not intended as the stable channel')
    })
})

describe('GitHub API integration boundary', () => {
    test('follows pagination links beyond 100 issues with authenticated requests', async () => {
        const requestedPages: string[] = []
        const client = new GitHubReleaseClient(
            'RentnerKev/RentnerProxy',
            'test-token',
            async (input, init) => {
                const url = new URL(String(input))
                requestedPages.push(url.searchParams.get('page') ?? '')
                expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-token')
                if (url.searchParams.get('page') === '1') {
                    return Response.json(
                        Array.from({ length: 100 }, (_, index) => issue(index + 1)),
                        {
                            headers: {
                                Link:
                                    '<' +
                                    url.toString().replace('page=1', 'page=2') +
                                    '>; rel="next"',
                            },
                        },
                    )
                }
                return Response.json([issue(101), issue(102)])
            },
        )

        const issues = await client.listClosedIssues({})
        expect(issues).toHaveLength(102)
        expect(requestedPages).toEqual(['1', '2'])
    })

    test('uses a matching milestone instead of a release window', async () => {
        const issueQueries: URL[] = []
        const client = new GitHubReleaseClient(
            'RentnerKev/RentnerProxy',
            'test-token',
            async (input) => {
                const url = new URL(String(input))
                if (url.pathname.endsWith('/releases')) {
                    return Response.json([])
                }
                if (url.pathname.endsWith('/milestones')) {
                    return Response.json([{ number: 42, title: '1.2.0' }])
                }
                issueQueries.push(url)
                return Response.json([issue(1, { labels: ['enhancement'] })])
            },
        )

        const result = await generateReleaseNotes(
            {
                repository: 'RentnerKev/RentnerProxy',
                release: {
                    id: 10,
                    tagName: 'v1.2.0',
                    prerelease: false,
                    publishedAt: '2026-09-02T12:00:00Z',
                },
                channel: 'stable',
                image: 'ghcr.io/rentnerkev/rentnerproxy',
                bannerAssetName: 'release-banner.png',
                config,
            },
            client,
        )
        expect(result.selectionMode).toBe('milestone')
        expect(result.milestoneNumber).toBe(42)
        expect(issueQueries[0]?.searchParams.get('milestone')).toBe('42')
        expect(issueQueries[0]?.searchParams.has('since')).toBeFalse()
    })

    test('uses the previous stable publication for a stable fallback window', async () => {
        const issueQueries: URL[] = []
        const client = new GitHubReleaseClient(
            'RentnerKev/RentnerProxy',
            'test-token',
            async (input) => {
                const url = new URL(String(input))
                if (url.pathname.endsWith('/releases')) {
                    return Response.json([
                        release({
                            id: 1,
                            tag_name: 'v1.0.0',
                            published_at: '2026-01-01T00:00:00Z',
                        }),
                        release({
                            id: 2,
                            tag_name: 'v1.1.0-beta.1',
                            prerelease: true,
                            published_at: '2026-02-01T00:00:00Z',
                        }),
                    ])
                }
                if (url.pathname.endsWith('/milestones')) {
                    return Response.json([])
                }
                issueQueries.push(url)
                return Response.json([
                    issue(1, { closed_at: '2026-02-10T00:00:00Z', labels: ['bug'] }),
                ])
            },
        )

        const result = await generateReleaseNotes(
            {
                repository: 'RentnerKev/RentnerProxy',
                release: {
                    id: 3,
                    tagName: 'v1.1.0',
                    prerelease: false,
                    publishedAt: '2026-03-01T00:00:00Z',
                },
                channel: 'stable',
                image: 'ghcr.io/rentnerkev/rentnerproxy',
                bannerAssetName: 'release-banner.png',
                config,
            },
            client,
        )
        expect(result.previousTag).toBe('v1.0.0')
        expect(issueQueries[0]?.searchParams.get('since')).toBe('2026-01-01T00:00:00Z')
        expect(result.body).toContain('/compare/v1.0.0...v1.1.0')
    })

    test('uses the immediately previous publication for a development fallback', async () => {
        const issueQueries: URL[] = []
        const client = new GitHubReleaseClient(
            'RentnerKev/RentnerProxy',
            'test-token',
            async (input) => {
                const url = new URL(String(input))
                if (url.pathname.endsWith('/releases')) {
                    return Response.json([
                        release({
                            id: 1,
                            tag_name: 'v1.0.0',
                            published_at: '2026-01-01T00:00:00Z',
                        }),
                        release({
                            id: 2,
                            tag_name: 'v1.1.0-beta.1',
                            prerelease: true,
                            published_at: '2026-02-01T00:00:00Z',
                        }),
                    ])
                }
                if (url.pathname.endsWith('/milestones')) {
                    return Response.json([])
                }
                issueQueries.push(url)
                return Response.json([
                    issue(1, { closed_at: '2026-02-05T00:00:00Z', labels: ['bug'] }),
                ])
            },
        )

        const result = await generateReleaseNotes(
            {
                repository: 'RentnerKev/RentnerProxy',
                release: {
                    id: 3,
                    tagName: 'v1.1.0-beta.2',
                    prerelease: true,
                    publishedAt: '2026-02-10T00:00:00Z',
                },
                channel: 'dev',
                image: 'ghcr.io/rentnerkev/rentnerproxy',
                bannerAssetName: 'release-banner.png',
                config,
            },
            client,
        )
        expect(result.previousTag).toBe('v1.1.0-beta.1')
        expect(issueQueries[0]?.searchParams.get('since')).toBe('2026-02-01T00:00:00Z')
    })
})
