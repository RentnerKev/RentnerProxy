import { describe, expect, test } from 'bun:test'
import {
    fixtureResultSchema,
    controllerBodySchema,
    backendBodySchema,
    certificateIndexSchema,
} from '../../../../../../scripts/runtime-reliability/responses.validation.ts'
import { certificateEventsSchema } from '../../../../../../scripts/smoke/certificates/responses.validation.ts'

describe('smoke response validation', () => {
    test('retains extension responses without inventing phase-specific fields', () => {
        const input = {
            ok: true as const,
            desiredRevision: 'sha256:fixture',
            counts: { proxyHosts: 50 },
            runtimeStatus: { activeRevision: 'old' },
        }
        const result = fixtureResultSchema.parse(input)
        expect(result).toEqual(input)
        expect(result.persistedJobCounts).toBeUndefined()
    })
    test('rejects malformed fixture jobs and preserves valid job details', () => {
        const job = {
            id: 'job',
            stage: 'failed',
            certificateId: null,
            proxyHostId: 'host',
            errorCode: 'acme_failed',
            retryAvailable: true,
            extension: 'retained',
        }
        const result = fixtureResultSchema.parse({
            ok: true,
            desiredRevision: 'revision',
            currentJob: job,
        })
        expect(result.currentJob).toEqual(job)
        expect(
            fixtureResultSchema.safeParse({
                ok: true,
                desiredRevision: 'revision',
                currentJob: { ...job, certificateId: 123 },
            }).success,
        ).toBe(false)
    })
    test('rejects non-object bodies and malformed bounded event entries', () => {
        expect(controllerBodySchema.safeParse([]).success).toBe(false)
        expect(backendBodySchema.safeParse({ backend: 123 }).success).toBe(false)
        expect(certificateEventsSchema.safeParse([{ id: 'event', kind: 'issued' }]).success).toBe(
            false,
        )
        expect(
            controllerBodySchema.safeParse({
                events: [{ id: 'event', operationId: null, kind: 'issued' }],
            }).success,
        ).toBe(false)
    })
    test('keeps certificate retry index extensions for round-trip fixture mutation', () => {
        const input = {
            version: 1,
            certificates: {
                certificate: {
                    operation: 'idle',
                    fingerprint: 'active',
                    nextAttemptAt: 'later',
                    retryAfter: { seconds: 30 },
                },
            },
        }
        const result = certificateIndexSchema.parse(input)
        result.certificates.certificate!.nextAttemptAt = '2000-01-01T00:00:00Z'
        delete result.certificates.certificate!.retryAfter
        expect(result.version).toBe(1)
        expect(result.certificates.certificate!.fingerprint).toBe('active')
        expect(result.certificates.certificate!.nextAttemptAt).toBe('2000-01-01T00:00:00Z')
        expect(result.certificates.certificate!.retryAfter).toBeUndefined()
    })
})
