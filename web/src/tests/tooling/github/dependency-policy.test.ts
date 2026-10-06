import { describe, expect, test } from 'bun:test'

import {
    evaluateCargo,
    evaluateCargoDiagnostics,
    evaluateDatabase,
    evaluateGo,
    evaluateIdentity,
    evaluateImage,
    evaluateInventory,
} from '../../../../../.github/scripts/security/dependency-policy.ts'

const now = Date.parse('2026-10-06T12:00:00Z')
const image = {
    descriptor: { name: 'grype', version: '0.120.0' },
    distro: { name: 'debian' },
    matches: [],
}
const goConfig = {
    protocol_version: 'v1.0.0',
    scanner_name: 'govulncheck',
    scan_mode: 'binary',
    db_last_modified: '2026-10-06T10:00:00Z',
    scanner_version: 'v1.8.0',
    db: 'https://vuln.go.dev',
    scan_level: 'symbol',
}

describe('deployed dependency policy', () => {
    test('accepts a clean complete scanner response and blocks moderate, high, critical and unknown advisories even without fixes', () => {
        expect(() => evaluateImage(image)).not.toThrow()
        for (const severity of ['Medium', 'Moderate', 'High', 'Critical', 'Unknown']) {
            expect(() =>
                evaluateImage({
                    ...image,
                    matches: [
                        {
                            vulnerability: {
                                id: 'CVE-fixture',
                                severity,
                                fix: { state: 'not-fixed' },
                            },
                        },
                    ],
                }),
            ).toThrow('policy failed')
        }
        expect(() =>
            evaluateImage({
                ...image,
                matches: [{ vulnerability: { id: 'CVE-low', severity: 'Low' } }],
            }),
        ).not.toThrow()
        expect(() => evaluateImage({ ...image, ignoredMatches: [{}] })).toThrow('forbidden')
        expect(() => evaluateImage({ matches: [] })).toThrow()
    })

    test('rejects incomplete copied-binary and OS inventories', () => {
        const artifacts = [
            'bun',
            'valkey',
            'postgresql-18',
            'github.com/caddyserver/caddy/v2',
            'github.com/crowdsecurity/crowdsec',
        ].map((name) => ({ name, version: '1.2.3', type: 'binary' }))
        const complete = [
            ...artifacts,
            { name: 'libc6', version: '2.40', type: 'deb' },
            { name: 'react', version: '19', type: 'npm' },
        ]
        expect(() => evaluateInventory({ artifacts: complete })).not.toThrow()
        expect(() =>
            evaluateInventory({
                artifacts: complete.filter((artifact) => artifact.name !== 'valkey'),
            }),
        ).toThrow('valkey')
        expect(() => evaluateInventory({ artifacts })).toThrow('OS inventory')
    })

    test('blocks binary findings, preserves symbol evidence, and rejects stale or absent advisory data', () => {
        expect(() =>
            evaluateGo(
                [
                    { config: goConfig },
                    { SBOM: { modules: [{ path: 'example.org/safe', version: 'v1.0.0' }] } },
                ],
                'binary',
                now,
            ),
        ).not.toThrow()
        expect(() =>
            evaluateGo(
                [
                    { config: goConfig },
                    { SBOM: { modules: [{ path: 'example.org/vulnerable', version: 'v1.0.0' }] } },
                    {
                        finding: {
                            osv: 'GO-fixture',
                            trace: [{ module: 'example.org/vulnerable', function: 'Exploit' }],
                        },
                    },
                ],
                'binary',
                now,
            ),
        ).toThrow('policy failed')
        expect(() =>
            evaluateGo(
                [
                    { config: { ...goConfig, db_last_modified: '2026-09-01T00:00:00Z' } },
                    { SBOM: {} },
                ],
                'binary',
                now,
            ),
        ).toThrow('stale')
        expect(() => evaluateGo([{ config: goConfig }], 'binary', now)).toThrow('inventory missing')
        expect(() => evaluateGo([], 'binary', now)).toThrow()
    })

    test('checks version-specific community module query independently of the local replacement', () => {
        const config = { ...goConfig, scan_mode: 'query' }
        expect(() => evaluateGo([{ config }], 'query', now)).not.toThrow()
        expect(() =>
            evaluateGo([{ config }, { osv: { id: 'GO-community-fixture' } }], 'query', now),
        ).toThrow('policy failed')
    })

    test('rejects invalid, unavailable and stale Grype databases while accepting fresh verified metadata', () => {
        const database = { valid: true, schemaVersion: '6.0.5', built: '2026-10-06T10:00:00Z' }
        expect(() => evaluateDatabase(database, now)).not.toThrow()
        expect(() => evaluateDatabase({ ...database, built: '2026-10-01T10:00:00Z' }, now)).toThrow(
            'stale',
        )
        expect(() => evaluateDatabase({ ...database, valid: false }, now)).toThrow('Invalid')
        expect(() => evaluateDatabase({ valid: true }, now)).toThrow()
    })

    test('rejects the actual no-fetch CI response with null metadata and missing crate-index diagnostics', () => {
        const actualCiResponse = {
            database: { 'advisory-count': 1290, 'last-commit': null, 'last-updated': null },
            lockfile: { 'dependency-count': 199 },
            settings: {
                target_arch: [],
                target_os: [],
                severity: null,
                ignore: [],
                informational_warnings: ['unmaintained', 'unsound', 'notice'],
            },
            vulnerabilities: { found: false, count: 0, list: [] },
            warnings: {},
        }
        const evidence = {
            revision: 'ef6173cbc5c50ec8166f9a5b28f07834144373ee',
            fetchedAt: '2026-10-06T10:00:00Z',
        }
        expect(() => evaluateCargo(actualCiResponse, evidence, now)).toThrow('metadata')
        expect(() =>
            evaluateCargoDiagnostics(
                "error: couldn't check if the package is yanked: No such crate index: asn1-rs",
            ),
        ).toThrow('incomplete')
        expect(() =>
            evaluateCargoDiagnostics(
                "warning: couldn't update crates.io index: network unavailable",
            ),
        ).toThrow('incomplete')
        expect(() =>
            evaluateCargoDiagnostics(
                'Fetching advisory database\nLoaded 1290 security advisories\nUpdating crates.io index',
            ),
        ).not.toThrow()
        const fetched = {
            ...actualCiResponse,
            database: {
                ...actualCiResponse.database,
                'last-commit': evidence.revision,
                'last-updated': '2026-10-06T09:00:00Z',
            },
        }
        expect(() => evaluateCargo(fetched, evidence, now)).not.toThrow()
        expect(() =>
            evaluateCargo(fetched, { ...evidence, revision: 'b'.repeat(40) }, now),
        ).toThrow('metadata')
        expect(() =>
            evaluateCargo({ ...fetched, warnings: { yanked: [{}] } }, evidence, now),
        ).toThrow('yanked')
        expect(() =>
            evaluateCargo(
                { ...fetched, settings: { ...fetched.settings, ignore: ['RUSTSEC-fixture'] } },
                evidence,
                now,
            ),
        ).toThrow('filtered')
        expect(() =>
            evaluateCargo(fetched, { ...evidence, fetchedAt: '2026-09-01T09:00:00Z' }, now),
        ).toThrow('stale')
    })

    test('checks the complete locked Cargo response and exact immutable identity', () => {
        const clean = {
            database: {
                'last-commit': 'a'.repeat(40),
                'last-updated': '2026-10-06T10:00:00Z',
                'advisory-count': 1290,
            },
            lockfile: { 'dependency-count': 199 },
            settings: { ignore: [], severity: null, target_arch: [], target_os: [] },
            warnings: {},
            vulnerabilities: { count: 0, list: [] },
        }
        expect(() =>
            evaluateCargo(
                clean,
                { revision: 'a'.repeat(40), fetchedAt: '2026-10-06T10:00:00Z' },
                now,
            ),
        ).not.toThrow()
        expect(() =>
            evaluateCargo(
                {
                    ...clean,
                    vulnerabilities: { count: 1, list: [{ advisory: { id: 'RUSTSEC-fixture' } }] },
                },
                { revision: 'a'.repeat(40), fetchedAt: '2026-10-06T10:00:00Z' },
                now,
            ),
        ).toThrow('RustSec')
        expect(() => evaluateCargo({ vulnerabilities: { count: 0, list: [] } }, {})).toThrow()
        expect(
            evaluateIdentity({ revision: 'a'.repeat(40), digest: `sha256:${'b'.repeat(64)}` })
                .revision,
        ).toBe('a'.repeat(40))
        expect(() => evaluateIdentity({ revision: 'main', digest: 'latest' })).toThrow('immutable')
    })
})
