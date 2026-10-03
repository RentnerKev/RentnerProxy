import { describe, expect, test } from 'bun:test'

import { sortAuditEventsNewestFirst } from '@/lib/Admin/AuditLogs/auditLogs.ts'
import type { AuditEventDto } from '@/lib/Admin/AuditLogs/Types/audit-events.types.ts'

function auditEvent(id: string, timestamp: string): AuditEventDto {
    return {
        id,
        timestamp,
        actorUserId: null,
        actorKind: 'system',
        actorDisplayName: null,
        action: 'update',
        resource: 'proxy-host',
        targetId: null,
        result: 'success',
        metadata: {},
    }
}

describe('audit event sorting', () => {
    test('places newest events first without changing the input', () => {
        const oldest = auditEvent('oldest', '2026-10-01T10:00:00.000Z')
        const newest = auditEvent('newest', '2026-10-03T10:00:00.000Z')
        const middle = auditEvent('middle', '2026-10-02T10:00:00.000Z')
        const events = Object.freeze([oldest, newest, middle])

        expect(sortAuditEventsNewestFirst(events)).toEqual([newest, middle, oldest])
        expect(events).toEqual([oldest, newest, middle])
    })

    test('preserves input order for events at the same instant', () => {
        const first = auditEvent('first', '2026-10-02T10:00:00.000Z')
        const second = auditEvent('second', '2026-10-02T10:00:00+00:00')
        const newer = auditEvent('newer', '2026-10-03T10:00:00.000Z')

        expect(sortAuditEventsNewestFirst([first, newer, second])).toEqual([newer, first, second])
    })
})
