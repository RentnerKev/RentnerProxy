import { describe, expect, test } from 'bun:test'

import {
    COMMENT_MARKER,
    MAX_DISPLAYED_MATCHES,
    POSSIBLE_DUPLICATE_THRESHOLD,
    RELATED_THRESHOLD,
    calculateFileOverlap,
    calculateIssueSimilarity,
    calculatePullRequestSimilarity,
    classifySimilarity,
    diceSimilarity,
    extractLinkedIssueNumbers,
    hasActiveDuplicateTimeline,
    jaccardSimilarity,
    normalizeText,
    parseOwnedLabels,
    rankCandidates,
    renderDuplicateComment,
    textSimilarity,
    upsertManagedComment,
} from '../../../.github/scripts/duplicate-triage'
import type {
    CandidateMatch,
    CommentWriter,
    TriageItem,
} from '../../../.github/scripts/duplicate-triage'

const REPOSITORY = 'RentnerKev/RentnerProxy'

function triageItem(overrides: Partial<TriageItem> = {}): TriageItem {
    return {
        body: '',
        closedAt: null,
        draft: false,
        files: [],
        kind: 'issue',
        labels: [],
        linkedIssues: [],
        merged: false,
        number: 1,
        revision: '',
        state: 'open',
        stateReason: null,
        title: 'Default title',
        updatedAt: '2026-09-01T00:00:00Z',
        ...overrides,
    }
}

function match(item: TriageItem, score: number, fileOverlap = 0): CandidateMatch {
    return {
        item,
        similarity: {
            body: 0,
            fileOverlap,
            labels: 0,
            score,
            sharedLinkedIssues: [],
            title: score,
        },
    }
}

class RecordingCommentWriter implements CommentWriter {
    readonly created: string[] = []
    readonly updated: { readonly id: number; readonly body: string }[] = []
    readonly deleted: number[] = []

    createComment(body: string): Promise<void> {
        this.created.push(body)
        return Promise.resolve()
    }

    updateComment(commentId: number, body: string): Promise<void> {
        this.updated.push({ body, id: commentId })
        return Promise.resolve()
    }

    deleteComment(commentId: number): Promise<void> {
        this.deleted.push(commentId)
        return Promise.resolve()
    }
}

describe('duplicate triage workflow', () => {
    test('skips Dependabot pull requests by pull request author while retaining issue triage', async () => {
        const workflow = await Bun.file(
            new URL('../../../.github/workflows/duplicate-triage.yml', import.meta.url),
        ).text()

        expect(workflow).toContain("github.event_name != 'pull_request_target'")
        expect(workflow).toContain("github.event.pull_request.user.login != 'dependabot[bot]'")
        expect(workflow).not.toContain('github.actor')
    })
})

describe('duplicate triage text normalization and metrics', () => {
    test('gives identical titles maximum similarity', () => {
        expect(textSimilarity('ACME certificate renewal', 'ACME certificate renewal')).toBe(1)
    })

    test('combines Jaccard and Dice token overlap', () => {
        expect(jaccardSimilarity(['acme', 'renew'], ['acme', 'restart'])).toBeCloseTo(1 / 3)
        expect(diceSimilarity(['acme', 'renew'], ['acme', 'restart'])).toBeCloseTo(0.5)
        expect(textSimilarity('acme renew', 'acme restart')).toBeGreaterThan(0.5)
    })

    test('recognizes the ACME restart paraphrase as a true positive', () => {
        const score = textSimilarity(
            'ACME certificate does not renew after controller restart',
            'Certificate renewal fails when restarting controller',
        )

        expect(score).toBeGreaterThanOrEqual(POSSIBLE_DUPLICATE_THRESHOLD)
    })

    test('does not classify certificate upload as a high renewal duplicate', () => {
        const score = textSimilarity('Certificate renewal fails', 'Certificate upload fails')

        expect(score).toBeLessThan(POSSIBLE_DUPLICATE_THRESHOLD)
    })

    test('keeps unrelated issues below the related threshold', () => {
        expect(textSimilarity('ACME renewal failure', 'Passkey registration timeout')).toBeLessThan(
            RELATED_THRESHOLD,
        )
    })

    test('uses a similar body when titles contain no useful tokens', () => {
        const current = triageItem({
            body: 'Redis session expires after controller restart',
            title: 'Bug',
        })
        const candidate = triageItem({
            body: 'Redis session expires after controller restart',
            number: 2,
            title: 'Issue',
        })

        expect(calculateIssueSimilarity(current, candidate).score).toBe(1)
    })

    test('ignores issue and pull request template boilerplate', () => {
        const boilerplate = `
## Description
## Steps to reproduce
## Expected behavior
## Actual behavior
## What changed?
## Why?
- [x] Existing tests pass.
- [ ] I have not included unrelated changes.
`

        expect(normalizeText(boilerplate)).toEqual([])
    })

    test('removes fenced code and stack traces from the prose signal', () => {
        const left = '```shell\nError: connection refused\nat runtime.ts:42\n```'
        const right = '```shell\nError: connection refused\nat runtime.ts:42\n```'

        expect(textSimilarity(left, right)).toBe(0)
    })

    test('keeps shared prose while ignoring divergent fenced logs', () => {
        const left = 'ACME renewal stops after restart\n```text\nstack trace alpha\n```'
        const right = 'ACME renewal stops after restart\n```text\nstack trace beta\n```'

        expect(textSimilarity(left, right)).toBe(1)
    })

    test('normalizes links while retaining visible technical text and versions', () => {
        expect(
            normalizeText('[OpenResty 1.31](https://example.invalid/docs) with PostgreSQL 18'),
        ).toEqual(['openresty', '1.31', 'postgresql', '18'])
    })

    test('normalizes Unicode with NFKC', () => {
        expect(normalizeText('Ｐｒｏｘｙ Ｒｅｄｉｒｅｃｔ')).toEqual(['proxy', 'redirect'])
    })

    test('handles empty and very large bodies safely', () => {
        expect(normalizeText(null)).toEqual([])
        expect(normalizeText('')).toEqual([])
        expect(normalizeText('proxy '.repeat(100_000)).length).toBeLessThanOrEqual(2_048)
    })
})

describe('duplicate triage issue scoring and ranking', () => {
    test('shared labels increase a text score without becoming sufficient alone', () => {
        const current = triageItem({ labels: ['bug'], title: 'Certificate renewal fails' })
        const withoutSharedLabel = calculateIssueSimilarity(
            current,
            triageItem({ labels: ['enhancement'], number: 2, title: 'Certificate upload fails' }),
        ).score
        const withSharedLabel = calculateIssueSimilarity(
            current,
            triageItem({ labels: ['bug'], number: 3, title: 'Certificate upload fails' }),
        ).score
        const labelsOnly = calculateIssueSimilarity(
            triageItem({ labels: ['bug'], title: 'Bug' }),
            triageItem({ labels: ['bug'], number: 4, title: 'Issue' }),
        ).score

        expect(withSharedLabel).toBeGreaterThan(withoutSharedLabel)
        expect(labelsOnly).toBeLessThan(RELATED_THRESHOLD)
    })

    test('classifies exact threshold boundaries', () => {
        expect(classifySimilarity(POSSIBLE_DUPLICATE_THRESHOLD)).toBe('high')
        expect(classifySimilarity(POSSIBLE_DUPLICATE_THRESHOLD - 0.0001)).toBe('related')
        expect(classifySimilarity(RELATED_THRESHOLD)).toBe('related')
        expect(classifySimilarity(RELATED_THRESHOLD - 0.0001)).toBe('none')
    })

    test('excludes the current item and pull requests from issue candidates', () => {
        const current = triageItem({ number: 10, title: 'ACME renewal failure' })
        const candidates = [
            triageItem({ number: 10, title: current.title }),
            triageItem({ kind: 'pull_request', number: 11, title: current.title }),
            triageItem({ number: 12, title: current.title }),
        ]

        expect(
            rankCandidates(current, candidates).map((candidate) => candidate.item.number),
        ).toEqual([12])
    })

    test('deduplicates candidates that move between paginated states', () => {
        const current = triageItem({ number: 10, title: 'ACME renewal failure' })
        const candidates = [
            triageItem({
                number: 12,
                state: 'open',
                title: current.title,
                updatedAt: '2026-09-01T00:00:00Z',
            }),
            triageItem({
                number: 12,
                state: 'closed',
                title: current.title,
                updatedAt: '2026-09-02T00:00:00Z',
            }),
        ]

        const ranked = rankCandidates(current, candidates)
        expect(ranked).toHaveLength(1)
        expect(ranked[0]?.item.state).toBe('closed')
    })

    test('sorts ties by open state, recency, and then candidate number', () => {
        const current = triageItem({ number: 1, title: 'ACME renewal failure' })
        const candidates = [
            triageItem({
                number: 2,
                state: 'closed',
                title: current.title,
                updatedAt: '2026-09-03T00:00:00Z',
            }),
            triageItem({
                number: 3,
                title: current.title,
                updatedAt: '2026-09-01T00:00:00Z',
            }),
            triageItem({
                number: 4,
                title: current.title,
                updatedAt: '2026-09-02T00:00:00Z',
            }),
        ]

        expect(
            rankCandidates(current, candidates).map((candidate) => candidate.item.number),
        ).toEqual([4, 3, 2])
    })

    test('limits displayed results', () => {
        const current = triageItem({ number: 100, title: 'ACME renewal failure' })
        const candidates = Array.from({ length: MAX_DISPLAYED_MATCHES + 3 }, (_, index) =>
            triageItem({ number: index + 1, title: current.title }),
        )

        expect(rankCandidates(current, candidates)).toHaveLength(MAX_DISPLAYED_MATCHES)
    })
})

describe('duplicate triage pull request signals', () => {
    test('calculates file overlap as intersection over union', () => {
        expect(calculateFileOverlap(['a.ts', 'b.ts'], ['b.ts', 'c.ts'])).toBeCloseTo(1 / 3)
        expect(calculateFileOverlap(['a.ts'], ['b.ts'])).toBe(0)
        expect(calculateFileOverlap([], [])).toBe(0)
    })

    test('extracts only same-repository closing references', () => {
        expect(
            extractLinkedIssueNumbers(
                'Fixes #123\nCloses RentnerKev/RentnerProxy#124\nResolves other/repo#999',
                REPOSITORY,
            ),
        ).toEqual([123, 124])
    })

    test('ignores linked-issue keywords inside fenced examples', () => {
        expect(
            extractLinkedIssueNumbers(
                '```markdown\nFixes #123\n```\nActual change resolves #124',
                REPOSITORY,
            ),
        ).toEqual([124])
    })

    test('treats a shared linked issue as a strong related signal', () => {
        const current = triageItem({
            kind: 'pull_request',
            linkedIssues: [123],
            title: 'Certificate UI copy',
        })
        const candidate = triageItem({
            kind: 'pull_request',
            linkedIssues: [123],
            number: 2,
            title: 'Redis runtime cleanup',
        })
        const score = calculatePullRequestSimilarity(current, candidate).score

        expect(score).toBeGreaterThanOrEqual(RELATED_THRESHOLD)
        expect(score).toBeLessThan(POSSIBLE_DUPLICATE_THRESHOLD)
    })

    test('classifies redirect-host implementations with file overlap as high', () => {
        const current = triageItem({
            files: ['web/src/features/redirect.ts', 'controller/src/runtime/renderer.rs'],
            kind: 'pull_request',
            title: 'Add Redirect Hosts',
        })
        const candidate = triageItem({
            files: ['web/src/features/redirect.ts', 'controller/src/runtime/renderer.rs'],
            kind: 'pull_request',
            number: 2,
            title: 'Implement redirect host support',
        })

        expect(calculatePullRequestSimilarity(current, candidate).score).toBeGreaterThanOrEqual(
            POSSIBLE_DUPLICATE_THRESHOLD,
        )
    })

    test('keeps redirect UI and runtime work related when files do not overlap', () => {
        const current = triageItem({
            files: ['web/src/features/redirect-ui.tsx'],
            kind: 'pull_request',
            title: 'Redirect Host UI',
        })
        const candidate = triageItem({
            files: ['controller/src/runtime/renderer.rs'],
            kind: 'pull_request',
            number: 2,
            title: 'Redirect Host runtime renderer',
        })

        expect(classifySimilarity(calculatePullRequestSimilarity(current, candidate).score)).toBe(
            'related',
        )
    })
})

describe('duplicate triage managed comment', () => {
    test('renders the marker, statuses, safe links, and escaped untrusted titles', () => {
        const candidate = triageItem({
            number: 42,
            state: 'closed',
            stateReason: 'not_planned',
            title: 'Danger | [click](bad) @maintainer <tag> `code` *bold* _italics_ ~strike~ \\path\nnext',
        })
        const body = renderDuplicateComment(
            'issue',
            [match(candidate, POSSIBLE_DUPLICATE_THRESHOLD)],
            REPOSITORY,
            new Set(['possible-duplicate']),
        )

        expect(body).toContain(COMMENT_MARKER)
        expect(body).toContain('rentnerproxy-duplicate-triage-owned-labels:possible-duplicate')
        expect(body).toContain('https://github.com/RentnerKev/RentnerProxy/issues/42')
        expect(body).toContain('CLOSED · NOT PLANNED')
        expect(body).toContain('&#64;maintainer')
        expect(body).toContain('&#124;')
        expect(body).toContain('&#42;bold&#42;')
        expect(body).toContain('&#95;italics&#95;')
        expect(body).toContain('&#126;strike&#126;')
        expect(body).toContain('&#92;path')
        expect(body).not.toContain('(bad)')
        expect(body).not.toContain('@maintainer')
    })

    test('renders pull request file overlap and shared issue context', () => {
        const candidate = triageItem({ kind: 'pull_request', number: 9, title: 'Redirect hosts' })
        const candidateMatch: CandidateMatch = {
            item: candidate,
            similarity: {
                body: 0,
                fileOverlap: 0.78,
                labels: 0,
                score: POSSIBLE_DUPLICATE_THRESHOLD,
                sharedLinkedIssues: [123],
                title: 1,
            },
        }
        const body = renderDuplicateComment('pull_request', [candidateMatch], REPOSITORY)

        expect(body).toContain('78%')
        expect(body).toContain('/pull/9')
        expect(body).toContain('/issues/123')
        expect(body).toContain('No pull request has been closed or merged automatically.')
    })

    test('updates one existing bot comment, deletes extras, and does not create spam', async () => {
        const writer = new RecordingCommentWriter()
        await upsertManagedComment(
            writer,
            [
                { body: 'old', id: 10 },
                { body: 'duplicate', id: 11 },
            ],
            'new',
        )

        expect(writer.created).toEqual([])
        expect(writer.updated).toEqual([{ body: 'new', id: 10 }])
        expect(writer.deleted).toEqual([11])
    })

    test('does not patch an unchanged managed comment', async () => {
        const writer = new RecordingCommentWriter()
        await upsertManagedComment(writer, [{ body: 'same', id: 10 }], 'same')

        expect(writer.created).toEqual([])
        expect(writer.updated).toEqual([])
        expect(writer.deleted).toEqual([])
    })

    test('parses only supported workflow-owned labels', () => {
        const body = `${COMMENT_MARKER}\n<!-- rentnerproxy-duplicate-triage-owned-labels:possible-duplicate,bug,related -->`

        expect([...parseOwnedLabels(body)].toSorted()).toEqual(['possible-duplicate', 'related'])
    })

    test('respects the latest manual duplicate timeline decision', () => {
        expect(
            hasActiveDuplicateTimeline([
                { created_at: '2026-09-01T00:00:00Z', event: 'marked_as_duplicate' },
                { created_at: '2026-09-02T00:00:00Z', event: 'unmarked_as_duplicate' },
            ]),
        ).toBeFalse()
        expect(
            hasActiveDuplicateTimeline([
                { created_at: '2026-09-01T00:00:00Z', event: 'unmarked_as_duplicate' },
                { created_at: '2026-09-02T00:00:00Z', event: 'marked_as_duplicate' },
            ]),
        ).toBeTrue()
    })
})
