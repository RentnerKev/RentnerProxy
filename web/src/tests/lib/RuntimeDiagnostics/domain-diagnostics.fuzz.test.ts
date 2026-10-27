import { expect, test } from 'bun:test'
import * as fc from 'fast-check'
import {
    domainDiagnosticsInputSchema,
    domainDiagnosticsResultSchema,
} from '@/lib/RuntimeDiagnostics/domainDiagnostics.ts'
import { domainDiagnosticsFixture, domainDiagnosticsInput } from './domain-diagnostics.fixture.ts'

test('arbitrary foreign fields and overlong selectors cannot expand the probe boundary', () => {
    fc.assert(
        fc.property(
            fc
                .string({ minLength: 1, maxLength: 80 })
                .filter((key) => !['hostType', 'hostId', 'domain'].includes(key)),
            fc.jsonValue(),
            (key, value) => {
                expect(
                    domainDiagnosticsInputSchema.safeParse({
                        ...domainDiagnosticsInput,
                        [key]: value,
                    }).success,
                ).toBeFalse()
            },
        ),
        { numRuns: 150 },
    )
    fc.assert(
        fc.property(fc.string({ minLength: 254, maxLength: 512 }), (domain) => {
            expect(
                domainDiagnosticsInputSchema.safeParse({ ...domainDiagnosticsInput, domain })
                    .success,
            ).toBeFalse()
        }),
        { numRuns: 100 },
    )
})

test('unsupported stage statuses, foreign stage fields and excess timing never sanitize into success', () => {
    const fixture = domainDiagnosticsFixture()
    fc.assert(
        fc.property(
            fc.constantFrom('configuration', 'dns', 'upstream', 'tls'),
            fc
                .string()
                .filter(
                    (value) => !['passed', 'failed', 'unknown', 'not_applicable'].includes(value),
                ),
            fc.jsonValue(),
            (stage, status, raw) => {
                expect(
                    domainDiagnosticsResultSchema.safeParse({
                        ...fixture,
                        stages: {
                            ...fixture.stages,
                            [stage]: { ...fixture.stages[stage], status },
                        },
                    }).success,
                ).toBeFalse()
                expect(
                    domainDiagnosticsResultSchema.safeParse({
                        ...fixture,
                        stages: {
                            ...fixture.stages,
                            [stage]: { ...fixture.stages[stage], private: raw },
                        },
                    }).success,
                ).toBeFalse()
                expect(
                    domainDiagnosticsResultSchema.safeParse({
                        ...fixture,
                        stages: {
                            ...fixture.stages,
                            [stage]: { ...fixture.stages[stage], code: `unsupported:${status}` },
                        },
                    }).success,
                ).toBeFalse()
            },
        ),
        { numRuns: 150 },
    )
    fc.assert(
        fc.property(fc.integer({ min: 12_001, max: 1_000_000 }), (durationMs) => {
            expect(
                domainDiagnosticsResultSchema.safeParse({
                    ...fixture,
                    stages: {
                        ...fixture.stages,
                        upstream: { ...fixture.stages.upstream, durationMs },
                    },
                }).success,
            ).toBeFalse()
        }),
        { numRuns: 100 },
    )
})
