import { describe, expect, test } from 'bun:test'

import {
    captureRestoreSessionsSql,
    mergeRestoreSessionsSql,
} from '../../../../../../scripts/backup/restore-session-continuity.ts'

const session = {
    id: '01900000-0000-7000-8000-000000000001',
    user_id: '01900000-0000-7000-8000-000000000002',
    token_hash: 'a'.repeat(64),
    created_at: '2026-10-31T12:00:00+00:00',
    last_seen_at: '2026-11-01T10:00:00+00:00',
    reauthenticated_at: '2026-11-01T10:00:00+00:00',
    expires_at: '2026-11-07T12:00:00+00:00',
}

describe('restore session continuity SQL', () => {
    test('captures only current active unexpired hashed sessions', () => {
        expect(captureRestoreSessionsSql).toContain("u.status = 'active'")
        expect(captureRestoreSessionsSql).toContain('s.expires_at > now()')
        expect(captureRestoreSessionsSql).toContain('LIMIT 10001')
        expect(captureRestoreSessionsSql).not.toContain('password_hash')
    })

    test('deletes archived sessions before preserving eligible current sessions in one transaction', () => {
        const sql = mergeRestoreSessionsSql(JSON.stringify([session]))
        expect(sql.indexOf('BEGIN;')).toBeLessThan(
            sql.indexOf('DELETE FROM rentnerproxy.sessions;'),
        )
        expect(sql.indexOf('DELETE FROM rentnerproxy.sessions;')).toBeLessThan(
            sql.indexOf('INSERT INTO rentnerproxy.sessions'),
        )
        expect(sql).toContain('JOIN rentnerproxy.users u ON u.id = s.user_id')
        expect(sql).toContain("u.status = 'active' AND s.expires_at > now()")
        expect(sql).toContain('COMMIT;')
        expect(mergeRestoreSessionsSql('[]')).toContain('DELETE FROM rentnerproxy.sessions;')
    })

    test('rejects malformed hashes, unexpected token material and duplicate sessions', () => {
        for (const value of [
            [{ ...session, token_hash: "';DROP TABLE users;--" }],
            [{ ...session, token: 'never-export-raw-tokens' }],
            [session, session],
            [{ ...session, expires_at: 'not-a-date' }],
        ])
            expect(() => mergeRestoreSessionsSql(JSON.stringify(value))).toThrow()
    })
})
