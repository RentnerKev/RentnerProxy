import { describe, expect, test } from 'bun:test'

import { findAvailableUpdate } from '@/server/Updates/releases.service.ts'

const release = (tag_name: string, prerelease = false, draft = false) => ({
    tag_name,
    prerelease,
    draft,
})

describe('application update selection', () => {
    test('compares versions numerically and ignores drafts and invalid tags', () => {
        expect(
            findAvailableUpdate('v1.0.9', [
                release('v1.0.10'),
                release('v9.0.0', false, true),
                release('preview-123'),
            ]),
        ).toBe('1.0.10')
    })
    test('stable installations do not advertise prereleases', () => {
        expect(findAvailableUpdate('1.0.0', [release('v2.0.0-beta.1', true)])).toBeNull()
    })
    test('prereleases advance numerically and can upgrade to stable', () => {
        expect(findAvailableUpdate('v1.0.0-beta.2', [release('v1.0.0-beta.10', true)])).toBe(
            '1.0.0-beta.10',
        )
        expect(findAvailableUpdate('v1.0.0-beta.2', [release('v1.0.0')])).toBe('1.0.0')
    })
    test('selects the newest allowed version without reordering the release list', () => {
        const releases = [
            release('v2.0.0'),
            release('v1.0.10'),
            release('v4.0.0-alpha.1'),
            release('v1.9.9'),
            release('v3.0.0', false, true),
        ]
        const original = releases.slice()
        expect(findAvailableUpdate('1.0.0', releases)).toBe('2.0.0')
        expect(releases).toEqual(original)
    })
    test('preserves the first release when versions differ only in build metadata', () => {
        expect(
            findAvailableUpdate('1.0.0', [
                release('v1.0.1+first'),
                release('v1.0.1+second'),
                release('v1.0.1'),
            ]),
        ).toBe('1.0.1+first')
    })
    test('equal, older, development and malformed versions have no update', () => {
        for (const version of ['1.0.0', '2.0.0', '0.0.0-dev', 'preview-123']) {
            expect(findAvailableUpdate(version, [release('v1.0.0')])).toBeNull()
        }
        expect(findAvailableUpdate('1.0.0', {})).toBeNull()
    })
})
