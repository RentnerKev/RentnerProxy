import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test'
import type { AuthDomainErrorCode } from '@/server/Auth/Core/Types/errors.types.ts'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import { RateLimitError, RateLimitUnavailableError } from '@/server/Valkey/rate-limiter.service.ts'
const request = new Request('https://auth.example.com/reset')
const status = mock((_value: number) => undefined)
const header = mock((_name: string, _value: string) => undefined)
let clientIp: string | undefined = '192.0.2.7'
const authLimit = mock(async (_request: unknown, overrides: { resolveClientIp: () => string }) =>
    overrides.resolveClientIp(),
)
const mfaLimit = mock(async (_request: unknown, overrides: { resolveClientIp: () => string }) =>
    overrides.resolveClientIp(),
)
mock.module('@tanstack/react-start/server', () => ({
    getRequest: () => request,
    getRequestIP: () => clientIp,
    setResponseStatus: status,
    setResponseHeader: header,
}))
mock.module('@/server/Valkey/rate-limiter.service.ts', () => ({
    RateLimitError,
    RateLimitUnavailableError,
    enforceAuthRateLimit: authLimit,
    enforceLoginMfaRateLimit: mfaLimit,
}))
const transport = await import('@/server/Auth/transport.server.ts')
beforeEach(() => {
    status.mockClear()
    header.mockClear()
    authLimit.mockClear()
    mfaLimit.mockClear()
    clientIp = '192.0.2.7'
})
afterEach(() => mock.restore())

test('public authentication errors map every domain category to safe statuses and messages', () => {
    const cases: readonly [AuthDomainErrorCode, number][] = [
        ['authentication_required', 401],
        ['reauthentication_required', 403],
        ['permission_denied', 403],
        ['owner_required', 403],
        ['user_not_found', 404],
        ['role_not_found', 404],
        ['email_conflict', 409],
        ['last_active_owner', 409],
        ['role_in_use', 409],
        ['system_role_immutable', 409],
        ['invalid_email', 400],
        ['invalid_input', 400],
        ['password_policy', 400],
        ['unknown_permission', 400],
        ['unknown_role', 400],
        ['service_unavailable', 503],
        ['user_not_active', 503],
    ]
    for (const [code, expected] of cases) {
        const result = transport.actionFailure(
            new AuthDomainError(code, 'private database detail'),
            'Safe fallback',
        )
        expect(status).toHaveBeenLastCalledWith(expected)
        expect(result.success).toBe(false)
        expect(result.message).not.toContain('private')
        expect(() =>
            transport.throwPublicQueryError(new AuthDomainError(code, 'private query')),
        ).toThrow()
        expect(status).toHaveBeenLastCalledWith(expected)
    }
    expect(transport.actionFailure(new Error('secret driver detail'), 'Safe fallback')).toEqual({
        success: false,
        message: 'Safe fallback',
    })
    expect(() => transport.throwPublicQueryError(new Error('private query'))).toThrow(
        'The requested data is temporarily unavailable.',
    )
    expect(status).toHaveBeenLastCalledWith(503)
})

test('rate limit failures publish a bounded Retry-After and an unavailable limiter stays unavailable', () => {
    expect(
        transport.actionFailure(new RateLimitError(3, 2, 1501, 'login'), 'fallback').success,
    ).toBe(false)
    expect(status).toHaveBeenLastCalledWith(429)
    expect(header).toHaveBeenLastCalledWith('Retry-After', '2')
    transport.actionFailure(new RateLimitError(3, 2, 0, 'login'), 'fallback')
    expect(header).toHaveBeenLastCalledWith('Retry-After', '1')
    expect(
        transport.actionFailure(new RateLimitUnavailableError('request_failed'), 'fallback'),
    ).toEqual({ success: false, message: transport.AUTH_UNAVAILABLE_MESSAGE })
    expect(status).toHaveBeenLastCalledWith(503)
})

test('sensitive and MFA limits bind the actual request and derive IP fallbacks at invocation time', async () => {
    await transport.enforceSensitiveLimit('reset', 'user@example.com')
    expect(authLimit).toHaveBeenLastCalledWith(
        { action: 'reset', email: 'user@example.com', request },
        expect.any(Object),
    )
    expect(await authLimit.mock.results[0]?.value).toBe('192.0.2.7')
    await transport.enforceLoginMfaLimit('user-1')
    expect(mfaLimit).toHaveBeenLastCalledWith({ userId: 'user-1', request }, expect.any(Object))
    expect(await mfaLimit.mock.results[0]?.value).toBe('192.0.2.7')
    clientIp = undefined
    await transport.enforceSensitiveLimit('login', 'other@example.com')
    expect(await authLimit.mock.results.at(-1)?.value).toBe('unknown')
    await transport.enforceLoginMfaLimit('user-2')
    expect(await mfaLimit.mock.results.at(-1)?.value).toBe('unknown')
    await transport.enforceAnonymousSensitiveLimit('reset', 'anonymous-scope')
    expect(authLimit).toHaveBeenLastCalledWith(
        { action: 'reset', email: 'anonymous-scope:unknown', request },
        expect.any(Object),
    )
    expect(await authLimit.mock.results.at(-1)?.value).toBe('unknown')
})

test('password-reset timing floor sleeps only the remaining interval', async () => {
    spyOn(Date, 'now').mockReturnValue(10000)
    const sleep = spyOn(Bun, 'sleep').mockResolvedValue(undefined)
    await transport.waitForResetTimingFloor(9700)
    expect(sleep).toHaveBeenCalledWith(300)
    await transport.waitForResetTimingFloor(9000)
    expect(sleep).toHaveBeenCalledTimes(1)
})
