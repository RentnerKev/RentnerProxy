import { describe, expect, test } from 'bun:test'
import { UPSTREAM_FAILOVER_DEFAULTS } from '@/config/upstream-pools.config.ts'
import {
    proxyUpstreamPoolSchema,
    proxyUpstreamHealthPathSchema,
} from '@/lib/ProxyRuntime/upstreamPool.ts'
import { proxyHostFormSchema } from '@/features/Admin/ProxyHostManagement/validation.ts'
const base = { policy: 'round_robin' as const, members: [{ host: 'backend.internal', port: 8080 }] }
const defaults = UPSTREAM_FAILOVER_DEFAULTS

describe('upstream failover contracts', () => {
    test('preserves absent failover and orders canonical fields without inferred defaults', () => {
        expect(proxyUpstreamPoolSchema.parse(base)).toEqual(base)
        const parsed = proxyUpstreamPoolSchema.parse({
            ...base,
            failover: {
                retries: defaults.retries,
                passive: defaults.passive,
                active: defaults.active,
            },
        })
        expect(Object.keys(parsed)).toEqual(['policy', 'members', 'failover'])
        expect(Object.keys(parsed.failover!)).toEqual(['active', 'passive', 'retries'])
        expect(
            proxyUpstreamPoolSchema.parse({ ...base, failover: { passive: defaults.passive } })
                .failover,
        ).toEqual({ passive: defaults.passive })
    })
    test('accepts exact limits and rejects fractional, out of range and unknown values', () => {
        const activeBounds = {
            intervalSeconds: [5, 300],
            timeoutSeconds: [1, 30],
            fails: [1, 10],
            passes: [1, 10],
            expectedStatus: [200, 399],
        }
        const passiveBounds = { failDurationSeconds: [1, 300], maxFails: [1, 10] }
        const retryBounds = {
            maxRetries: [1, 15],
            tryDurationSeconds: [1, 30],
            tryIntervalMilliseconds: [100, 5000],
        }
        for (const [block, values, bounds] of [
            ['active', { ...defaults.active, intervalSeconds: 300 }, activeBounds],
            ['passive', defaults.passive, passiveBounds],
            [
                'retries',
                { ...defaults.retries, tryDurationSeconds: 30, tryIntervalMilliseconds: 100 },
                retryBounds,
            ],
        ] as const) {
            for (const [field, range] of Object.entries(bounds)) {
                for (const value of [range[0], range[1]])
                    expect(
                        proxyUpstreamPoolSchema.safeParse({
                            ...base,
                            failover: {
                                passive: defaults.passive,
                                [block]: { ...values, [field]: value },
                            },
                        }).success,
                    ).toBeTrue()
                for (const value of [range[0]! - 1, range[1]! + 1, range[0]! + 0.5, '1', null])
                    expect(
                        proxyUpstreamPoolSchema.safeParse({
                            ...base,
                            failover: {
                                passive: defaults.passive,
                                [block]: { ...values, [field]: value },
                            },
                        }).success,
                    ).toBeFalse()
            }
        }
        for (const failover of [
            {},
            { active: null },
            { unknown: true },
            { active: { ...defaults.active, unknown: 1 } },
            { passive: { ...defaults.passive, unhealthyStatus: [500] } },
            { retries: defaults.retries },
        ])
            expect(proxyUpstreamPoolSchema.safeParse({ ...base, failover }).success).toBeFalse()
    })
    test('enforces timeout, retry duration and ordered first-policy constraints', () => {
        for (const pool of [
            {
                ...base,
                failover: { active: { ...defaults.active, intervalSeconds: 5, timeoutSeconds: 6 } },
            },
            {
                ...base,
                failover: {
                    passive: defaults.passive,
                    retries: {
                        ...defaults.retries,
                        tryDurationSeconds: 1,
                        tryIntervalMilliseconds: 1001,
                    },
                },
            },
            {
                ...base,
                policy: 'first',
                failover: {
                    passive: { ...defaults.passive, maxFails: 3 },
                    retries: { ...defaults.retries, maxRetries: 2 },
                },
            },
        ])
            expect(proxyUpstreamPoolSchema.safeParse(pool).success).toBeFalse()
        expect(
            proxyUpstreamPoolSchema.safeParse({
                ...base,
                policy: 'first',
                failover: {
                    passive: { ...defaults.passive, maxFails: 3 },
                    retries: { ...defaults.retries, maxRetries: 3 },
                },
            }).success,
        ).toBeTrue()
    })
    test('restricts active URIs to finite safe relative ASCII request targets', () => {
        for (const path of ['/', '/health?ready=true', '/health%2Fready', '/' + 'a'.repeat(2047)])
            expect(proxyUpstreamHealthPathSchema.safeParse(path).success).toBeTrue()
        for (const path of [
            '',
            'health',
            '//host/health',
            'https://host/health',
            '/health#fragment',
            '/health\\evil',
            '/{placeholder}',
            '/health%2',
            '/health%GG',
            '/health%',
            '/hello world',
            '/health\n',
            '/héalth',
            '/\u212a',
            '/\u017f',
            '/health\u00a0',
            '/' + 'a'.repeat(2048),
        ])
            expect(proxyUpstreamHealthPathSchema.safeParse(path).success).toBeFalse()
    })
    test('converts nested form numbers and rejects blank or exponent drafts', () => {
        const failover = {
            active: Object.fromEntries(
                Object.entries(defaults.active).map(([key, value]) => [key, String(value)]),
            ),
            passive: Object.fromEntries(
                Object.entries(defaults.passive).map(([key, value]) => [key, String(value)]),
            ),
            retries: Object.fromEntries(
                Object.entries(defaults.retries).map(([key, value]) => [key, String(value)]),
            ),
        }
        const input = {
            domains: ['pool.test'],
            forwardScheme: 'http',
            forwardHost: 'backend.internal',
            forwardPort: '8080',
            enabled: true,
            upstreamPool: {
                ...base,
                members: [{ host: 'backend.internal', port: '8080' }],
                failover,
            },
        }
        expect(proxyHostFormSchema.parse(input).upstreamPool?.failover).toEqual(defaults)
        for (const intervalSeconds of ['', '1e2', '5.5'])
            expect(
                proxyHostFormSchema.safeParse({
                    ...input,
                    upstreamPool: {
                        ...input.upstreamPool,
                        failover: { ...failover, active: { ...failover.active, intervalSeconds } },
                    },
                }).success,
            ).toBeFalse()
    })
})
