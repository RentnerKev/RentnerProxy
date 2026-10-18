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
    test('enforces every edge of the alpha, beta and stable channel matrix', () => {
        for (const current of ['1.0.0-alpha.1', '1.0.0-beta.1', '1.0.0']) {
            for (const target of ['2.0.0-alpha.1', '2.0.0-beta.1', '2.0.0']) {
                const currentChannel = current.includes('alpha')
                    ? 0
                    : current.includes('beta')
                      ? 1
                      : 2
                const targetChannel = target.includes('alpha') ? 0 : target.includes('beta') ? 1 : 2
                expect(
                    findAvailableUpdate(current, [release(`v${target}`, targetChannel !== 2)]),
                ).toBe(targetChannel >= currentChannel ? target : null)
            }
        }
    })
    test('excludes dev, PR, unknown channels and invalid SemVer identifiers', () => {
        for (const version of [
            'dev-0123456789ab',
            'pr-42',
            '1.0.0-dev.1',
            '1.0.0-beta.2.dev',
            '1.0.0-beta.PR.42',
            '1.0.0+pr.42',
            '1.0.0+dev',
            '1.0.0-rc.1',
            '1.0.0-stable',
            '1.00.0',
            '1.0.0-beta.01',
            '1.0.0-beta..2',
            '1.0.0-beta.',
            ' 1.0.0',
            '1.0.0+',
        ]) {
            expect(findAvailableUpdate(version, [release('v9.0.0')])).toBeNull()
            expect(findAvailableUpdate('0.0.1-alpha.1', [release(`v${version}`, true)])).toBeNull()
        }
    })
    test('requires GitHub prerelease metadata to agree with the official channel', () => {
        expect(findAvailableUpdate('1.0.0-beta.1', [release('v1.0.0-beta.2')])).toBeNull()
        expect(findAvailableUpdate('1.0.0-beta.1', [release('v1.0.0', true)])).toBeNull()
    })
    test('does not treat build metadata as an upgrade or downgrade', () => {
        expect(findAvailableUpdate('1.0.0+build.1', [release('v1.0.0+build.2')])).toBeNull()
        expect(findAvailableUpdate('1.0.0-beta.2', [release('v1.0.0-alpha.99', true)])).toBeNull()
    })
    test('compares arbitrarily large numeric identifiers without integer overflow', () => {
        expect(findAvailableUpdate('1.0.0', [release('v18446744073709551616.0.0')])).toBe(
            '18446744073709551616.0.0',
        )
        expect(
            findAvailableUpdate('1.0.0-beta.18446744073709551616', [
                release('v1.0.0-beta.18446744073709551617', true),
            ]),
        ).toBe('1.0.0-beta.18446744073709551617')
        expect(findAvailableUpdate('1.0.0-beta.9', [release('v1.0.0-beta.a', true)])).toBe(
            '1.0.0-beta.a',
        )
        expect(findAvailableUpdate('1.0.0-beta.2', [release('v1.0.0-beta.2.1', true)])).toBe(
            '1.0.0-beta.2.1',
        )
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
