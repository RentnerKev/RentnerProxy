import { describe, expect, test } from 'bun:test'
import * as fc from 'fast-check'

import {
    auditEventInputSchema,
    auditEventsQuerySchema,
    auditMetadataSchema,
    encodeAuditCursor,
    parseAuditCursor,
} from '../features/Admin/AuditLogs/validation'

const USER_ID = '0198d98a-0000-7000-8000-000000000001'

describe('audit event validation', () => {
    test('accepts the frozen event contract and rejects unknown fields/secrets', () => {
        const event = auditEventInputSchema.safeParse({
            actorUserId: USER_ID,
            actorKind: 'user',
            action: 'login',
            resource: 'session',
            targetId: null,
            result: 'success',
            metadata: { authenticationMethod: 'password' },
        })
        expect(event.success).toBe(true)
        expect(
            auditEventInputSchema.safeParse({
                actorUserId: USER_ID,
                actorKind: 'anonymous',
                action: 'login',
                resource: 'session',
                targetId: null,
                result: 'denied',
            }).success,
        ).toBe(false)
        expect(
            auditEventInputSchema.safeParse({
                actorUserId: USER_ID,
                actorKind: 'user',
                action: 'login',
                resource: 'session',
                targetId: null,
                result: 'success',
                metadata: { password: 'secret' },
            }).success,
        ).toBe(false)
        expect(
            auditEventInputSchema.safeParse({
                actorUserId: USER_ID,
                actorKind: 'user',
                action: 'login',
                resource: 'session',
                targetId: null,
                result: 'success',
                extra: true,
            }).success,
        ).toBe(false)
    })

    test('bounds metadata and query filters', () => {
        expect(auditMetadataSchema.safeParse({ count: 10_001 }).success).toBe(false)
        expect(auditEventsQuerySchema.safeParse({ from: '2026-02-30T00:00:00Z' }).success).toBe(
            false,
        )
        expect(
            auditEventsQuerySchema.safeParse({
                from: '2026-02-02T00:00:00Z',
                to: '2026-02-01T00:00:00Z',
            }).success,
        ).toBe(false)
        expect(auditEventsQuerySchema.safeParse({ limit: 101 }).success).toBe(false)
        expect(auditEventsQuerySchema.safeParse({ unknown: 'field' }).success).toBe(false)
    })

    test('uses an opaque, validated keyset cursor', () => {
        const cursor = encodeAuditCursor(new Date('2026-01-02T03:04:05.000Z'), USER_ID)
        expect(cursor).not.toContain('2026')
        expect(parseAuditCursor(cursor)).toEqual({
            timestamp: '2026-01-02T03:04:05.000Z',
            id: USER_ID,
        })
        expect(() => parseAuditCursor('not-json')).toThrow()
    })

    test('round-trips bounded cursors and rejects arbitrary metadata keys', () => {
        fc.assert(
            fc.property(fc.integer({ min: 0, max: 2_000_000_000_000 }), (timestamp) => {
                const cursor = encodeAuditCursor(new Date(timestamp), USER_ID)
                expect(parseAuditCursor(cursor)).toEqual({
                    timestamp: new Date(timestamp).toISOString(),
                    id: USER_ID,
                })
            }),
        )
        expect(auditMetadataSchema.safeParse({ submittedPassword: 'never store' }).success).toBe(
            false,
        )
    })
})
