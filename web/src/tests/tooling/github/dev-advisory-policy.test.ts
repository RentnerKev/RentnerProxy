import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
    type DevAcceptance,
    type DevContext,
    evaluateDevAcceptance,
    evaluateDevAssessment,
    evaluateDevContext,
    evaluateDevGo,
    evaluateDevImage,
} from '../../../../../.github/scripts/security/dev-advisory-policy.ts'
import { evaluateApprovedAssessment } from '../../../../../.github/scripts/security/dependency-policy.ts'

const root = resolve(import.meta.dir, '../../../../..')
const now = Date.parse('2026-10-08T00:00:00Z')
const revision = 'a'.repeat(40)
const digest = `sha256:${'b'.repeat(64)}`
const baselineHash = 'c'.repeat(64)
const acceptance: DevAcceptance = {
    schemaVersion: 1,
    repository: 'RentnerKev/RentnerProxy',
    issuedAt: '2026-10-07T21:45:00Z',
    expiresAt: '2026-10-14T21:45:00Z',
    evidenceRun: '37687435032',
    evidenceSha256: 'd'.repeat(64),
    reason: 'Synthetic, explicitly acknowledged development test',
    imageRules: [
        {
            id: 'CVE-2026-12345',
            namespace: 'debian:distro:debian:13',
            severity: 'High',
            fixState: 'not-fixed',
            name: 'fixture-library',
            version: '1.0.0',
            type: 'deb',
            purl: 'pkg:deb/debian/fixture-library@1.0.0?arch=amd64',
            paths: ['/var/lib/dpkg/status'],
            maxMatches: 1,
        },
    ],
    goRules: [
        {
            binary: 'caddy',
            id: 'GO-2026-12345',
            module: 'example.org/module',
            version: 'v1.0.0',
            packagePrefix: 'example.org/module/affected',
            maxFindings: 1,
        },
    ],
}
const context: DevContext = {
    repository: 'RentnerKev/RentnerProxy',
    eventName: 'workflow_dispatch',
    ref: 'refs/heads/main',
    workflowRef: 'RentnerKev/RentnerProxy/.github/workflows/dev-image.yml@refs/heads/main',
    workflowSha: revision,
    jobWorkflowRef:
        'RentnerKev/RentnerProxy/.github/workflows/publish-assessed-image.yml@refs/heads/main',
    jobWorkflowSha: revision,
    stage: 'publish',
    image: 'ghcr.io/rentnerkev/rentnerproxy',
    tags: 'dev',
    acknowledgement: 'true',
}
const match = {
    vulnerability: {
        id: 'CVE-2026-12345',
        namespace: 'debian:distro:debian:13',
        severity: 'High',
        fix: { state: 'not-fixed', versions: [] },
    },
    artifact: {
        name: 'fixture-library',
        version: '1.0.0',
        type: 'deb',
        purl: 'pkg:deb/debian/fixture-library@1.0.0?arch=amd64',
        locations: [{ path: '/var/lib/dpkg/status' }],
    },
}
const image = {
    descriptor: { name: 'grype', version: '0.120.1' },
    distro: { name: 'debian' },
    ignoredMatches: [],
    matches: [match],
}
const go = [
    {
        config: {
            protocol_version: 'v1.0.0',
            scanner_name: 'govulncheck',
            scanner_version: 'v1.8.0',
            scan_mode: 'binary',
            scan_level: 'symbol',
            db: 'https://vuln.go.dev',
            db_last_modified: '2026-10-07T21:00:00Z',
        },
    },
    { SBOM: { modules: [{ path: 'example.org/module', version: 'v1.0.0' }] } },
    {
        finding: {
            osv: 'GO-2026-12345',
            trace: [
                {
                    module: 'example.org/module',
                    version: 'v1.0.0',
                    package: 'example.org/module/affected',
                },
            ],
        },
    },
]
const assessment = {
    revision,
    digest,
    verdict: 'dev-risk-accepted',
    policy: 'explicit-known-advisories; dev-only',
    assessedAt: '2026-10-08T00:00:00Z',
    acceptanceSha256: baselineHash,
    expiresAt: acceptance.expiresAt,
    acceptedFindings: 2,
}

describe('explicit known advisory acceptance for dev', () => {
    test('only a manually acknowledged canonical main dev caller and publisher can use it', () => {
        expect(() => evaluateDevContext(context, acceptance)).not.toThrow()
        expect(() =>
            evaluateDevContext(
                { ...context, stage: 'build', jobWorkflowRef: context.workflowRef },
                acceptance,
            ),
        ).not.toThrow()
        for (const change of [
            { acknowledgement: 'false' },
            { acknowledgement: '' },
            { eventName: 'push' },
            { eventName: 'pull_request' },
            { repository: 'someone/RentnerProxy' },
            { ref: 'refs/heads/feature' },
            { workflowRef: context.workflowRef.replace('dev-image.yml', 'release-pipeline.yml') },
            { jobWorkflowRef: context.workflowRef },
            { jobWorkflowSha: 'b'.repeat(40) },
            { workflowSha: '' },
            { image: 'ghcr.io/rentnerkev/other-image' },
            { tags: 'dev\nlatest' },
            { tags: 'v1.0.0-beta.1' },
            { tags: 'preview' },
        ])
            expect(() => evaluateDevContext({ ...context, ...change }, acceptance)).toThrow()
    })

    test('acceptance expires absolutely and cannot renew itself from a new scan', () => {
        expect(evaluateDevAcceptance(acceptance, now).expiresAt).toBe(acceptance.expiresAt)
        for (const change of [
            { issuedAt: 'invalid' },
            { expiresAt: 'invalid' },
            { expiresAt: '2026-10-08T00:00:00Z' },
            { expiresAt: '2026-10-15T21:45:00Z' },
            { issuedAt: '2026-10-09T00:00:00Z' },
            { evidenceSha256: '' },
            { imageRules: [...acceptance.imageRules, ...acceptance.imageRules] },
            { goRules: [...acceptance.goRules, ...acceptance.goRules] },
        ])
            expect(() => evaluateDevAcceptance({ ...acceptance, ...change }, now)).toThrow()
        expect(() => evaluateDevAcceptance(acceptance, Date.parse(acceptance.expiresAt))).toThrow()
    })

    test('new advisories, available fixes, changed versions, severity and artifact locations fail closed', () => {
        expect(evaluateDevImage(image, acceptance)).toBe(1)
        for (const change of [
            { vulnerability: { ...match.vulnerability, id: 'CVE-2026-54321' } },
            { vulnerability: { ...match.vulnerability, namespace: 'nvd:cpe' } },
            { vulnerability: { ...match.vulnerability, severity: 'Critical' } },
            {
                vulnerability: {
                    ...match.vulnerability,
                    fix: { state: 'fixed', versions: ['1.0.1'] },
                },
            },
            { artifact: { ...match.artifact, version: '1.0.1' } },
            { artifact: { ...match.artifact, purl: 'pkg:deb/debian/other@1.0.0' } },
            { artifact: { ...match.artifact, type: 'npm' } },
            { artifact: { ...match.artifact, locations: [{ path: '/unexpected/binary' }] } },
        ])
            expect(() =>
                evaluateDevImage({ ...image, matches: [{ ...match, ...change }] }, acceptance),
            ).toThrow()
        expect(() => evaluateDevImage({ ...image, matches: [match, match] }, acceptance)).toThrow()
        expect(() => evaluateDevImage({ ...image, ignoredMatches: [match] }, acceptance)).toThrow()
        expect(() =>
            evaluateDevImage(
                { ...image, descriptor: { name: 'grype', version: 'unknown' } },
                acceptance,
            ),
        ).toThrow()
        expect(() => evaluateDevImage({ ...image, matches: [match, {}] }, acceptance)).toThrow()
    })

    test('Go acceptance binds binary, advisory, module, version and affected package; validity stays strict', () => {
        expect(evaluateDevGo(go, 'caddy', acceptance, now)).toBe(1)
        expect(() => evaluateDevGo(go, 'crowdsec', acceptance, now)).toThrow()
        expect(() => evaluateDevGo([...go, go[2]], 'caddy', acceptance, now)).toThrow()
        for (const frame of [
            { module: 'other.org/module', version: 'v1.0.0' },
            { module: 'example.org/module', version: 'v1.0.1' },
            {
                module: 'example.org/module',
                version: 'v1.0.0',
                package: 'example.org/module/unreviewed',
            },
        ])
            expect(() =>
                evaluateDevGo(
                    [...go.slice(0, 2), { finding: { osv: 'GO-2026-12345', trace: [frame] } }],
                    'caddy',
                    acceptance,
                    now,
                ),
            ).toThrow()
        expect(() =>
            evaluateDevGo([...go, { error: 'database unavailable' }], 'caddy', acceptance, now),
        ).toThrow()
        expect(() =>
            evaluateDevGo(
                go.filter((message) => !('SBOM' in message)),
                'caddy',
                acceptance,
                now,
            ),
        ).toThrow()
        expect(() => evaluateDevGo(go, 'caddy', acceptance, now + 8 * 86400_000)).toThrow()
    })

    test('a newly available Go fix or malformed fixed version blocks the exact previously accepted finding', () => {
        const finding = go[2]!.finding!
        for (const fixed_version of [undefined, ''])
            expect(
                evaluateDevGo(
                    [...go.slice(0, 2), { finding: { ...finding, fixed_version } }],
                    'caddy',
                    acceptance,
                    now,
                ),
            ).toBe(1)
        for (const fixed_version of ['v1.0.1', 123, null, {}])
            expect(() =>
                evaluateDevGo(
                    [...go.slice(0, 2), { finding: { ...finding, fixed_version } }],
                    'caddy',
                    acceptance,
                    now,
                ),
            ).toThrow()
    })

    test('a risk record never becomes approved and binds the exact fresh candidate and reviewed baseline', () => {
        const identity = { revision, digest }
        expect(() =>
            evaluateDevAssessment(assessment, identity, acceptance, baselineHash, now),
        ).not.toThrow()
        expect(() => evaluateApprovedAssessment(assessment, identity, now)).toThrow()
        for (const change of [
            { verdict: 'approved' },
            { verdict: 'blocked' },
            { acceptedFindings: 0 },
            { acceptedFindings: 3 },
            { digest: `sha256:${'c'.repeat(64)}` },
            { revision: 'b'.repeat(40) },
            { acceptanceSha256: 'd'.repeat(64) },
            { expiresAt: '2026-10-15T21:45:00Z' },
            { assessedAt: '2026-10-07T22:00:00Z' },
        ])
            expect(() =>
                evaluateDevAssessment(
                    { ...assessment, ...change },
                    identity,
                    acceptance,
                    baselineHash,
                    now,
                ),
            ).toThrow()
    })

    test('workflow inputs default off, release never opts in, and all other assessments remain mandatory', async () => {
        const dev = Bun.YAML.parse(
            await readFile(resolve(root, '.github/workflows/dev-image.yml'), 'utf8'),
        ) as {
            on: { workflow_dispatch: { inputs: Record<string, { default: boolean }> } }
        }
        expect(dev.on.workflow_dispatch.inputs.accept_known_dev_advisories?.default).toBe(false)
        const publisher = await readFile(
            resolve(root, '.github/workflows/publish-assessed-image.yml'),
            'utf8',
        )
        expect(publisher).toContain('default: false')
        expect(publisher.indexOf('Independently reassess candidate')).toBeLessThan(
            publisher.indexOf('GHCR_TOKEN:'),
        )
        expect(
            await readFile(resolve(root, '.github/workflows/release-pipeline.yml'), 'utf8'),
        ).not.toContain('accept_known_dev_advisories')
        const scan = await readFile(resolve(root, '.github/scripts/security/scan-image.sh'), 'utf8')
        expect(scan).toContain(
            'assess bash "$AUTOMATION_DIRECTORY/.github/scripts/security/audit-cargo.sh"',
        )
        expect(scan).toContain('assess bun --no-env-file "$policy" bun-audit')
        expect(scan).toContain('assess bun --no-env-file "$policy" query')
        expect(scan).toContain('if (( status != 0 )); then exit "$status"; fi')
        const publish = await readFile(
            resolve(root, '.github/scripts/security/publish-image.sh'),
            'utf8',
        )
        expect(publish.indexOf('accepted "$ASSESSED_REPORT" "$IDENTITY_REPORT"')).toBeLessThan(
            publish.indexOf('skopeo login'),
        )
    })
})
