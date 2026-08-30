import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { getResponseHeaders, getResponseStatus, requestHandler } from '@tanstack/react-start/server'

import { localizedActionFailure } from '../features/Auth/serverHelpers'
import { RateLimitError, RateLimitUnavailableError } from '../server/redis/rate-limiter.service'

const actorId = '019b85a0-7c29-7000-8abc-0123456789ab'

describe('sensitive action rate-limit placement', () => {
    test('denials occur before password, invite-token, or database work', async () => {
        const script = `
            import { mock } from 'bun:test'

            const actorId = '019b85a0-7c29-7000-8abc-0123456789ab'
            const calls = {
                database: 0,
                inviteLimit: [],
                passwordHash: 0,
                passwordLimit: [],
                passwordVerify: 0,
                pendingDisplayName: 0,
                token: 0,
            }
            const denied = Object.assign(new Error('blocked'), { code: 'RATE_LIMITED' })

            mock.module('./config/permissions.config.ts', () => ({
                PERMISSIONS: { ACCOUNT_UPDATE: 'account.update', USERS_CREATE: 'users.create' },
            }))
            mock.module('./db/schema.ts', () => ({
                passwordResetTokens: {},
                sessions: {},
                userInvites: {},
                users: {},
            }))
            mock.module('./server/redis/rate-limiter.service.ts', () => ({
                enforcePasswordChangeRateLimit: async (userId) => {
                    calls.passwordLimit.push(userId)
                    throw denied
                },
                enforceInviteRateLimit: async (input) => {
                    calls.inviteLimit.push(input)
                    throw denied
                },
            }))
            mock.module('./server/Auth/Access/sessions.service.ts', () => ({
                getCurrentSessionService: async () => ({
                    id: 'session-id',
                    user: { id: actorId, permissions: ['account.update'] },
                }),
                markSessionReauthenticatedInTransaction: async () => {},
                revokeOtherUserSessionsInTransaction: async () => {},
            }))
            mock.module('./server/Auth/Access/authorization.service.ts', () => ({
                requirePermissionService: async () => ({ id: actorId }),
            }))
            mock.module('./server/Auth/Access/rbac.service.ts', () => ({
                assertRoleAssignmentAllowedInTransaction: async () => {},
                getUserRoleKeysInTransaction: async () => [],
                hasOwnerRole: () => false,
                loadRolesByKeysInTransaction: async () => [],
                replaceUserRolesInTransaction: async () => {},
                requirePermissionInTransaction: async () => ({ id: actorId }),
            }))
            mock.module('./server/Auth/Core/database.server.ts', () => ({
                getAuthDatabase: () => {
                    calls.database += 1
                    throw new Error('database should not be reached')
                },
            }))
            mock.module('./server/Auth/Core/errors.server.ts', () => ({
                AuthDomainError: class AuthDomainError extends Error {},
            }))
            mock.module('./server/Auth/Core/identity.server.ts', () => ({
                PENDING_DISPLAY_NAME: 'Pending invitation',
                normalizeDisplayName: (value) => value,
                normalizeEmail: (value) => value.trim().toLowerCase(),
                normalizePendingDisplayName: (value) => {
                    calls.pendingDisplayName += 1
                    return value ?? 'Pending invitation'
                },
            }))
            mock.module('./server/Auth/Core/password.server.ts', () => ({
                hashPassword: async () => {
                    calls.passwordHash += 1
                    return 'hash'
                },
                verifyPassword: async () => {
                    calls.passwordVerify += 1
                    return false
                },
            }))
            mock.module('./server/Auth/Core/tokens.server.ts', () => ({
                createOpaqueToken: () => {
                    calls.token += 1
                    return 'token'
                },
                hashOpaqueToken: async () => {
                    calls.token += 1
                    return 'token-hash'
                },
                isValidOpaqueToken: () => true,
            }))

            const { changeCurrentPasswordService } = await import('./server/Auth/Account/account.service.ts')
            const { issueInviteService } = await import('./server/Auth/Setup/invites.service.ts')
            const outcomes = await Promise.allSettled([
                changeCurrentPasswordService({ currentPassword: 'old', password: 'new' }),
                issueInviteService({
                    displayName: 'New user',
                    email: ' Person@Example.com ',
                    roleKeys: [],
                }),
                issueInviteService({
                    displayName: 'New user',
                    email: 'person@example.com',
                    roleKeys: [],
                }),
            ])

            console.log(JSON.stringify({
                calls,
                outcomes: outcomes.map((outcome) => outcome.status),
            }))
        `
        const child = Bun.spawn([process.execPath, '-e', script], {
            cwd: fileURLToPath(new URL('../', import.meta.url)),
            stdout: 'pipe',
            stderr: 'pipe',
        })
        const [output, errors, code] = await Promise.all([
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
            child.exited,
        ])

        expect(code, errors).toBe(0)
        const result = JSON.parse(output)

        expect(result.outcomes).toEqual(['rejected', 'rejected', 'rejected'])
        expect(result.calls.passwordLimit).toEqual([actorId])
        expect(result.calls.inviteLimit).toEqual([
            { actorUserId: actorId, email: 'person@example.com' },
            { actorUserId: actorId, email: 'person@example.com' },
        ])
        expect(result.calls).toMatchObject({
            database: 0,
            passwordHash: 0,
            passwordVerify: 0,
            pendingDisplayName: 0,
            token: 0,
        })
    })
})

describe('sensitive action rate-limit responses', () => {
    test.each([
        [
            'rate limit',
            new RateLimitError(6, 5, 12_345, 'invite-target-email'),
            429,
            'errors.rateLimited',
            '13',
        ],
        [
            'Redis outage',
            new RateLimitUnavailableError('request_failed'),
            503,
            'errors.authUnavailable',
            null,
        ],
    ] as const)(
        'uses the existing localized HTTP response for %s',
        async (_name, error, status, message, retryAfter) => {
            const handler = requestHandler(async () => {
                const result = localizedActionFailure(error, 'admin.users.errors.inviteFailed')
                const headers = new Headers()
                for (const [key, value] of getResponseHeaders()) {
                    headers.set(key, String(value))
                }
                return Response.json(result, {
                    headers,
                    status: getResponseStatus(),
                })
            })
            const response = await handler(new Request('http://localhost/'), {})

            expect(response.status).toBe(status)
            expect(response.headers.get('Retry-After')).toBe(retryAfter)
            expect(await response.json()).toEqual({ success: false, message })
        },
    )
})
