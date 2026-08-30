import { describe, expect, test } from 'bun:test'

import { PERMISSIONS } from '../config/permissions.config'
import { RECENT_AUTHENTICATION_DURATION_MS } from '../config/auth-security.config'
import { isSessionRecentlyAuthenticated } from '../server/Auth/Access/authorization.service'
import type { CurrentSession } from '../server/Auth/Core/Types/auth-service.types'

function createSession(reauthenticatedAt: Date): CurrentSession {
    return {
        id: 'session-1',
        expiresAt: new Date(2_000_000),
        reauthenticatedAt,
        user: {
            displayName: 'Test User',
            email: 'test@example.com',
            id: 'user-1',
            language: 'en',
            permissions: [PERMISSIONS.APP_ACCESS],
            profileImageVersion: null,
            roles: [],
            themeMode: 'light',
        },
    }
}

describe('recent session authentication', () => {
    const now = 1_000_000

    test('accepts the exact five-minute boundary and rejects one millisecond later', () => {
        const session = createSession(new Date(now - RECENT_AUTHENTICATION_DURATION_MS))

        expect(isSessionRecentlyAuthenticated(session, now)).toBeTrue()
        expect(isSessionRecentlyAuthenticated(session, now + 1)).toBeFalse()
    })

    test('rejects a reauthentication timestamp in the future', () => {
        const session = createSession(new Date(now + 1))

        expect(isSessionRecentlyAuthenticated(session, now)).toBeFalse()
    })
})
