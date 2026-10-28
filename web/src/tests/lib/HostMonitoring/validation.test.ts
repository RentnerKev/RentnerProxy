import { describe, expect, test } from 'bun:test'
import {
    hostMonitoringSettingsSchema,
    hostMonitoringHistorySchema,
    saveHostMonitoringPolicySchema,
} from '@/lib/HostMonitoring/validation.ts'
import { HOST_MONITORING_DEFAULTS } from '@/config/host-monitoring.config.ts'

const proxyHostId = '00000000-0000-4000-8000-000000000001'

describe('host monitoring validation', () => {
    test('applies bounded defaults and accepts canonical punycode', () => {
        expect(hostMonitoringSettingsSchema.parse({ domain: 'example.test' })).toEqual({
            domain: 'example.test',
            ...HOST_MONITORING_DEFAULTS,
        })
        expect(
            hostMonitoringSettingsSchema.safeParse({ domain: 'xn--bcher-kva.test' }).success,
        ).toBeTrue()
    })

    test.each([
        '*.example.test',
        'EXAMPLE.test',
        'example.test.',
        ' example.test',
        'https://example.test',
        'example.test/path',
        '127.0.0.1',
        'bücher.test',
        'a..test',
        '-host.test',
        '',
    ])('rejects noncanonical or wildcard domain %s', (domain) => {
        expect(hostMonitoringSettingsSchema.safeParse({ domain }).success).toBeFalse()
    })

    test.each([
        ['intervalSeconds', 30, 86_400],
        ['timeoutMs', 1_000, 10_000],
        ['expectedStatus', 100, 599],
        ['failureThreshold', 1, 20],
        ['recoveryThreshold', 1, 20],
        ['retentionDays', 1, 30],
        ['sampleLimit', 10, 10_000],
        ['incidentLimit', 1, 1_000],
    ] as const)('enforces inclusive integer bounds for %s', (key, min, max) => {
        for (const value of [min, max])
            expect(
                hostMonitoringSettingsSchema.safeParse({ domain: 'example.test', [key]: value })
                    .success,
            ).toBeTrue()
        for (const value of [
            min - 1,
            max + 1,
            min + 0.5,
            String(min),
            Number.NaN,
            Number.POSITIVE_INFINITY,
        ])
            expect(
                hostMonitoringSettingsSchema.safeParse({ domain: 'example.test', [key]: value })
                    .success,
            ).toBeFalse()
    })

    test('requires optimistic version and rejects extra keys at every input boundary', () => {
        const input = { proxyHostId, expectedVersion: null, settings: { domain: 'example.test' } }
        expect(saveHostMonitoringPolicySchema.safeParse(input).success).toBeTrue()
        expect(
            saveHostMonitoringPolicySchema.safeParse({ proxyHostId, settings: input.settings })
                .success,
        ).toBeFalse()
        expect(
            saveHostMonitoringPolicySchema.safeParse({ ...input, enabled: true }).success,
        ).toBeFalse()
        expect(
            saveHostMonitoringPolicySchema.safeParse({
                ...input,
                settings: { ...input.settings, lease: 'forged' },
            }).success,
        ).toBeFalse()
        expect(
            hostMonitoringHistorySchema.safeParse({ proxyHostId, limit: 101 }).success,
        ).toBeFalse()
        expect(
            hostMonitoringHistorySchema.safeParse({ proxyHostId, before: 'yesterday' }).success,
        ).toBeFalse()
        expect(
            hostMonitoringHistorySchema.safeParse({
                proxyHostId,
                before: {
                    checkedAt: '2026-10-28T12:00:00.000Z',
                    id: proxyHostId,
                },
            }).success,
        ).toBeTrue()
        expect(
            hostMonitoringHistorySchema.safeParse({
                proxyHostId,
                before: {
                    checkedAt: '2026-10-28T12:00:00.000Z',
                    id: proxyHostId,
                    extra: true,
                },
            }).success,
        ).toBeFalse()
        expect(
            hostMonitoringHistorySchema.safeParse({ proxyHostId, cursor: 'extra' }).success,
        ).toBeFalse()
    })
})
