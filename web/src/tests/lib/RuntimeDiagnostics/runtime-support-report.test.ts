import { describe, expect, test } from 'bun:test'

import {
    canExportRuntimeSupportReport,
    createRuntimeSupportReport,
    serializeRuntimeSupportReport,
} from '@/lib/RuntimeDiagnostics/runtimeSupportReport.ts'
import {
    MAX_RUNTIME_SUPPORT_REPORT_BYTES,
    MAX_RUNTIME_SUPPORT_REPORT_COUNT,
} from '@/config/runtime-support-report.config.ts'
import { PERMISSIONS, RUNTIME_SUPPORT_REPORT_PERMISSIONS } from '@/config/permissions.config.ts'
import { supportReportFixture, SUPPORT_FIXTURE_REVISION } from './runtime-support-report.fixture.ts'

const capturedAt = new Date('2026-10-06T10:00:00Z')

describe('runtime support report allowlist', () => {
    test('reports healthy versions, availability, counts and exact revisions with a versioned format', () => {
        const report = createRuntimeSupportReport(supportReportFixture(), capturedAt)
        expect(report.format).toBe('rentnerproxy-runtime-support')
        expect(report.formatVersion).toBe(1)
        expect(report.capturedAt).toBe('2026-10-06T10:00:00.000Z')
        expect(report.completeness).toBe('complete')
        expect(report.unavailableSections).toEqual([])
        expect(report.versions.caddy).toEqual({
            state: 'available',
            value: '2.10.2',
            source: 'configured_binary',
        })
        expect(report.components.caddy).toEqual({ available: true, running: true })
        expect(report.runtime).toEqual({
            state: 'synced',
            desiredRevision: SUPPORT_FIXTURE_REVISION,
            appliedRevision: SUPPORT_FIXTURE_REVISION,
            lastApplyAt: '2026-10-06T08:00:00.000Z',
        })
        expect(report.configuration.data?.proxyHosts).toEqual({ total: 2, enabled: 1 })
        expect(report.certificates.data?.storedStatuses.valid).toBe(1)
        expect(report.certificateJobs.data?.stages.applied).toBe(1)
    })

    test('distinguishes a pending revision from missing observations', () => {
        const input = supportReportFixture()
        const report = createRuntimeSupportReport(
            { ...input, desiredRevision: 'sha256:' + 'b'.repeat(64) },
            capturedAt,
        )
        expect(report.runtime.state).toBe('pending')
        expect(report.completeness).toBe('complete')
        const stopped = createRuntimeSupportReport(
            {
                ...input,
                runtimeStatus: {
                    available: true,
                    running: false,
                    activeRevision: null,
                    lastApplyAt: null,
                },
            },
            capturedAt,
        )
        expect(stopped.runtime.state).toBe('pending')
        expect(stopped.components.caddy.running).toBe(false)
    })

    test('marks unavailable and partial observations explicitly without inventing zero counts', () => {
        const report = createRuntimeSupportReport(
            {
                ...supportReportFixture(),
                controllerHealth: null,
                caddyVersion: null,
                valkeyHealth: null,
                desiredRevision: null,
                runtimeStatus: null,
                certificates: null,
                certificateJobs: null,
            },
            capturedAt,
        )
        expect(report.completeness).toBe('partial')
        expect(report.unavailableSections).toEqual([
            'controller_version',
            'caddy_version',
            'controller',
            'valkey',
            'runtime',
            'certificates',
            'certificate_jobs',
        ])
        expect(report.certificates).toEqual({ state: 'unavailable', data: null })
        expect(report.components.caddy).toEqual({ available: null, running: null })
        expect(report.configuration.state).toBe('available')
    })

    test('never serializes extra or nested source payloads, including callable serialization hooks', () => {
        const input = supportReportFixture()
        const marker = 'PRIVATE-FIXTURE-CONTENT'
        const poisoned = JSON.parse(JSON.stringify(input)) as Record<
            string,
            Record<string, unknown>
        >
        for (const value of Object.values(poisoned)) {
            if (typeof value === 'object' && value !== null) {
                value.domains = [marker]
                value.environment = { nested: { token: marker, privateKeyPem: marker } }
                value.rawCaddyJson = marker
                value.toJSON = () => ({ leaked: marker })
            }
        }
        poisoned.configuration!.proxyHosts = {
            total: 2,
            enabled: 1,
            upstream: marker,
            headers: { authorization: marker },
        }
        const report = createRuntimeSupportReport({ ...input, ...poisoned }, capturedAt)
        const json = serializeRuntimeSupportReport(report)
        expect(json).not.toContain(marker)
        expect(json).not.toContain('environment')
        expect(json).not.toContain('domains')
        expect(json).not.toContain('rawCaddyJson')
        expect(json).not.toContain('authorization')
        expect(report.completeness).toBe('complete')
    })

    test.each([
        'secret.example.com',
        '1.2.3-secret.example.com',
        '2.10.2\nPRIVATE',
        '1.2.3+PRIVATE',
        'x'.repeat(1_000_000),
    ])('rejects arbitrary version text', (value) => {
        const report = createRuntimeSupportReport(
            {
                ...supportReportFixture(),
                applicationVersion: value,
                caddyVersion: { version: value },
            },
            capturedAt,
        )
        expect(report.versions.application.value).toBeNull()
        expect(report.versions.caddy.value).toBeNull()
    })

    test('excludes unknown error keys while preserving their aggregate count', () => {
        const input = supportReportFixture()
        const certificates = input.certificates as { errors: Record<string, number> }
        certificates.errors.none = 0
        certificates.errors.other = 1
        certificates.errors['PRIVATE-FIXTURE-ERROR'] = 999
        const report = createRuntimeSupportReport(input, capturedAt)
        expect(report.certificates.data?.errors.other).toBe(1)
        expect(serializeRuntimeSupportReport(report)).not.toContain('PRIVATE-FIXTURE-ERROR')
    })

    test.each([
        -1,
        1.5,
        Infinity,
        NaN,
        MAX_RUNTIME_SUPPORT_REPORT_COUNT + 1,
        '123',
        { secret: 'fixture' },
    ])('rejects invalid or excessive counts', (total) => {
        const report = createRuntimeSupportReport(
            {
                ...supportReportFixture(),
                configuration: {
                    proxyHosts: { total, enabled: 1 },
                    redirectHosts: { total: 1, enabled: 1 },
                },
            },
            capturedAt,
        )
        expect(report.configuration).toEqual({ state: 'unavailable', data: null })
        expect(report.completeness).toBe('partial')
    })

    test('rejects inconsistent aggregates and malformed status fields without leaking their content', () => {
        const input = supportReportFixture()
        const report = createRuntimeSupportReport(
            {
                ...input,
                certificates: { ...(input.certificates as object), total: 999 },
                runtimeStatus: {
                    available: 'PRIVATE',
                    running: true,
                    activeRevision: 'PRIVATE',
                    lastApplyAt: 'PRIVATE',
                },
            },
            capturedAt,
        )
        expect(report.runtime.state).toBe('unavailable')
        expect(report.runtime.appliedRevision).toBeNull()
        expect(report.runtime.lastApplyAt).toBeNull()
        expect(report.certificates.state).toBe('unavailable')
        expect(serializeRuntimeSupportReport(report)).not.toContain('PRIVATE')
    })

    test('keeps export size constant even when inputs contain huge nested payloads', () => {
        const fixture = supportReportFixture()
        const report = createRuntimeSupportReport(
            {
                ...fixture,
                controllerHealth: {
                    ...(fixture.controllerHealth as object),
                    payload: 'x'.repeat(1_000_000),
                },
                configuration: {
                    ...(fixture.configuration as object),
                    payload: Array.from({ length: 10_000 }, () => ({ password: 'PRIVATE' })),
                },
            },
            capturedAt,
        )
        const json = serializeRuntimeSupportReport(report)
        expect(new TextEncoder().encode(json).byteLength).toBeLessThan(
            MAX_RUNTIME_SUPPORT_REPORT_BYTES,
        )
        expect(json).toBe(
            serializeRuntimeSupportReport(createRuntimeSupportReport(fixture, capturedAt)),
        )
        expect(() =>
            serializeRuntimeSupportReport({
                ...report,
                capturedAt: 'x'.repeat(MAX_RUNTIME_SUPPORT_REPORT_BYTES),
            }),
        ).toThrow('support_report_limit')
    })

    test('requires every existing read capability, including for users with only app access', () => {
        expect(canExportRuntimeSupportReport([PERMISSIONS.APP_ACCESS])).toBe(false)
        expect(canExportRuntimeSupportReport(RUNTIME_SUPPORT_REPORT_PERMISSIONS)).toBe(true)
        for (const required of RUNTIME_SUPPORT_REPORT_PERMISSIONS) {
            expect(
                canExportRuntimeSupportReport(
                    RUNTIME_SUPPORT_REPORT_PERMISSIONS.filter(
                        (permission) => permission !== required,
                    ),
                ),
            ).toBe(false)
        }
    })
})
