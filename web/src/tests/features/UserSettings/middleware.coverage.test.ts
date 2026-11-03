import { beforeEach, describe, expect, test } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { createMiddlewareHarness } from '@/tests/Helpers/middlewareCoverage.ts'

const boundary = createMiddlewareHarness()
boundary.mockServices('@/server/Auth/Account/account.service.ts', ['changeCurrentPasswordService'])
boundary.mockServices('@/server/Auth/Account/profile-image.service.ts', [
    'getProfileImageAssetService',
    'updateCurrentProfileImageService',
])
boundary.mockServices('@/server/Auth/Passkey/passkey.service.ts', [
    'beginPasskeyRegistrationService',
    'deletePasskeyService',
    'finishPasskeyRegistrationService',
    'getPasskeysForUserService',
    'renamePasskeyService',
])
boundary.mockServices('@/server/Auth/TwoFactor/two-factor.service.ts', [
    'beginTotpSetupService',
    'confirmTotpSetupService',
    'disableTotpService',
    'getTwoFactorStatusService',
    'regenerateRecoveryCodesService',
])
boundary.mockServices('@/server/UserSettings/preferences.service.ts', [
    'updateCurrentUserLanguageService',
    'updateCurrentUserThemeModeService',
])
boundary.mockServices('@/server/UserSettings/navigation.service.ts', [
    'updateCurrentUserNavigationGroupService',
])
boundary.mockServices('@/server/UserSettings/appearance.service.ts', [
    'updateCurrentUserAccentColorService',
])
const handlers = await import('@/features/UserSettings/middleware.ts')
const id = '0198d98a-0000-7000-8000-000000000881'
const session = { user: { id, email: 'fixture@example.test' } }
const challengeId = 'a'.repeat(43)
const registration = {
    id: 'credential',
    rawId: 'credential',
    type: 'public-key',
    clientExtensionResults: {},
    response: { attestationObject: 'fixture', clientDataJSON: 'fixture' },
}
beforeEach(() => {
    boundary.reset()
    boundary.values.set('requireSessionService', session)
})

describe('personal account boundary', () => {
    test.each([
        [
            handlers.updateCurrentUserLanguageHandler,
            'updateCurrentUserLanguageService',
            { language: 'de' },
            'de',
        ],
        [
            handlers.updateCurrentUserThemeModeHandler,
            'updateCurrentUserThemeModeService',
            { themeMode: 'dark' },
            'dark',
        ],
        [
            handlers.updateCurrentUserNavigationGroupHandler,
            'updateCurrentUserNavigationGroupService',
            { expectedUserId: id, groupId: 'operations', expanded: true },
            { expanded: true },
        ],
        [
            handlers.updateProfileImageHandler,
            'updateCurrentProfileImageService',
            { imageDataUrl: 'data:image/webp;base64,YQ==' },
            undefined,
        ],
    ])(
        'delegates validated personal preferences through %s and maps failures',
        async (handler, service, input, value) => {
            boundary.values.set(service, value)
            expect(await boundary.invoke(handler, input)).toMatchObject({ success: true })
            expect(boundary.argumentsFor(service)).toHaveLength(1)
            boundary.failures.set(service, new Error('private account detail'))
            expect(await boundary.invoke(handler, input)).toMatchObject({ success: false })
        },
    )

    test('normalizes accent colors and rejects malformed or cross-field input without a write', async () => {
        boundary.values.set('updateCurrentUserAccentColorService', { accentColor: '#abcdef' })
        expect(
            await boundary.invoke(handlers.updateCurrentUserAccentColorHandler, {
                expectedUserId: id,
                accentColor: '#ABCDEF',
            }),
        ).toMatchObject({ success: true, accentColor: '#abcdef' })
        expect(boundary.argumentsFor('updateCurrentUserAccentColorService')).toEqual([
            [{ expectedUserId: id, accentColor: '#abcdef' }],
        ])
        boundary.calls.length = 0
        expect(
            await boundary.invoke(handlers.updateCurrentUserAccentColorHandler, {
                expectedUserId: id,
                accentColor: 'red',
                owner: id,
            }),
        ).toEqual({ success: false, message: 'userAppearance.errors.invalidColor' })
        expect(boundary.argumentsFor('updateCurrentUserAccentColorService')).toEqual([])
        boundary.failures.set('updateCurrentUserAccentColorService', new Error('private detail'))
        expect(
            await boundary.invoke(handlers.updateCurrentUserAccentColorHandler, {
                expectedUserId: id,
                accentColor: null,
            }),
        ).toEqual({ success: false, message: 'userAppearance.errors.saveFailed' })
    })

    test('requires password permission and delegates only the new password without reauthentication fields', async () => {
        const input = { password: 'fixture-new' }
        boundary.failures.set('requirePermissionService', new Error('denied'))
        expect(await boundary.invoke(handlers.changePasswordHandler, input)).toMatchObject({
            success: false,
        })
        expect(boundary.argumentsFor('changeCurrentPasswordService')).toEqual([])
        boundary.failures.clear()
        boundary.values.set('changeCurrentPasswordService', { success: true })
        expect(await boundary.invoke(handlers.changePasswordHandler, input)).toEqual({
            success: true,
            message: 'account.password.success.changed',
        })
        expect(boundary.argumentsFor('requirePermissionService')[0]).toEqual([
            PERMISSIONS.ACCOUNT_UPDATE,
        ])
        expect(boundary.argumentsFor('changeCurrentPasswordService')).toEqual([[input]])
        boundary.failures.set(
            'changeCurrentPasswordService',
            new Error('private credential failure'),
        )
        expect(await boundary.invoke(handlers.changePasswordHandler, input)).toEqual({
            success: false,
            message: 'account.password.error.update',
        })
        boundary.calls.length = 0
        await expect(
            boundary.invoke(handlers.changePasswordHandler, { password: '' }),
        ).rejects.toThrow()
        expect(boundary.argumentsFor('changeCurrentPasswordService')).toEqual([])
    })

    test('projects passkeys without private material and requires account-view permission', async () => {
        const createdAt = new Date('2026-01-01T00:00:00Z')
        boundary.values.set('getTwoFactorStatusService', { enabled: true })
        boundary.values.set('getPasskeysForUserService', [
            { id, name: 'Fixture', createdAt, lastUsedAt: null, privateCredential: 'omitted' },
            { id: 'second', name: 'Used', createdAt, lastUsedAt: createdAt },
        ])
        expect(await boundary.invoke(handlers.getSecurityStatusHandler)).toEqual({
            enabled: true,
            passkeys: [
                { id, name: 'Fixture', createdAt: createdAt.toISOString(), lastUsedAt: null },
                {
                    id: 'second',
                    name: 'Used',
                    createdAt: createdAt.toISOString(),
                    lastUsedAt: createdAt.toISOString(),
                },
            ],
        })
        expect(boundary.argumentsFor('requireSessionPermission')).toEqual([
            [session, PERMISSIONS.ACCOUNT_VIEW],
        ])
        boundary.failures.set('requireSessionPermission', new Error('denied'))
        await expect(boundary.invoke(handlers.getSecurityStatusHandler)).rejects.toThrow(
            'account.security.error.unavailable',
        )
    })

    test.each([
        [
            handlers.beginTotpSetupHandler,
            'beginTotpSetupService',
            {},
            'setup',
            { flowId: challengeId, otpAuthUri: 'otpauth://fixture', secret: 'fixture-secret' },
        ],
        [
            handlers.confirmTotpSetupHandler,
            'confirmTotpSetupService',
            { challengeId, code: '123456' },
            'setup',
            { success: true, recoveryCodes: ['fixture-code'] },
        ],
        [
            handlers.beginPasskeyRegistrationHandler,
            'beginPasskeyRegistrationService',
            {},
            'setup',
            { flowId: challengeId, options: { challenge: 'fixture' } },
        ],
        [
            handlers.finishPasskeyRegistrationHandler,
            'finishPasskeyRegistrationService',
            { challengeId, name: 'Fixture', response: registration },
            'setup',
            { success: true },
        ],
    ])(
        'rate limits sensitive %s before calling the credential service',
        async (handler, service, input, scope, result) => {
            boundary.failures.set('enforceSensitiveLimit', new Error('rate limited'))
            expect(await boundary.invoke(handler, input)).toMatchObject({ success: false })
            expect(boundary.argumentsFor(service)).toEqual([])
            expect(boundary.argumentsFor('enforceSensitiveLimit')).toEqual([
                [scope, session.user.email],
            ])
            boundary.failures.clear()
            boundary.values.set(service, result)
            expect(await boundary.invoke(handler, input)).toMatchObject({ success: true })
            expect(boundary.argumentsFor(service)).toHaveLength(1)
            if (service.startsWith('finish') || service === 'confirmTotpSetupService') {
                boundary.values.set(service, { success: false })
                expect(await boundary.invoke(handler, input)).toMatchObject({ success: false })
            }
        },
    )

    test.each([
        [handlers.disableTotpHandler, 'disableTotpService', {}, true, false],
        [
            handlers.regenerateRecoveryCodesHandler,
            'regenerateRecoveryCodesService',
            {},
            { success: true, recoveryCodes: ['fixture-code'] },
            { success: false },
        ],
        [
            handlers.renamePasskeyHandler,
            'renamePasskeyService',
            { passkeyId: id, name: 'Renamed' },
            true,
            false,
        ],
        [handlers.removePasskeyHandler, 'deletePasskeyService', { passkeyId: id }, true, false],
    ])(
        'binds %s account mutations to the current session and handles missing state',
        async (handler, service, input, success, absent) => {
            boundary.values.set(service, success)
            expect(await boundary.invoke(handler, input)).toMatchObject({ success: true })
            expect(boundary.argumentsFor(service)[0]?.[0]).toEqual(
                service.includes('Passkey')
                    ? expect.objectContaining({ currentSession: session })
                    : session,
            )
            boundary.values.set(service, absent)
            expect(await boundary.invoke(handler, input)).toMatchObject({ success: false })
            boundary.failures.set('requireSessionService', new Error('no session'))
            expect(await boundary.invoke(handler, input)).toMatchObject({ success: false })
        },
    )

    test('serves versioned image bytes with private immutable headers and safe uncached misses', async () => {
        const image = new Uint8Array([1, 2, 3])
        boundary.values.set('getProfileImageAssetService', { bytes: image })
        const response = await handlers.getProfileImageResponseHandler({
            request: new Request('https://example.test/image?v=7'),
            userId: id,
        })
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(image)
        expect(response.headers.get('Cache-Control')).toBe('private, max-age=31536000, immutable')
        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
        expect(boundary.argumentsFor('getProfileImageAssetService')).toEqual([[id, 7]])
        for (const fails of [false, true]) {
            boundary.values.set('getProfileImageAssetService', null)
            if (fails)
                boundary.failures.set(
                    'getProfileImageAssetService',
                    new Error('private image detail'),
                )
            // oxlint-disable-next-line no-await-in-loop -- Each outcome changes the shared boundary fixture.
            const missing = await handlers.getProfileImageResponseHandler({
                request: new Request('https://example.test/image'),
                userId: id,
            })
            expect(missing.status).toBe(404)
            expect(missing.headers.get('Cache-Control')).toBe('no-store')
        }
    })
})
