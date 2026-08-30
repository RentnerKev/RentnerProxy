import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server'
import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'

import { PERMISSIONS } from '../../../config/permissions.config'
import { PROFILE_IMAGE_VERSION_QUERY_KEY } from '../../../config/profile-image.config'
import {
    changeCurrentPasswordService,
    reauthenticateCurrentSessionWithPasswordService,
} from '../../../server/Auth/Account/account.service'
import {
    getProfileImageAssetService,
    updateCurrentProfileImageService,
} from '../../../server/Auth/Account/profile-image.service'
import {
    isSessionRecentlyAuthenticated,
    requirePermissionService,
    requireSessionPermission,
    requireSessionService,
} from '../../../server/Auth/Access/authorization.service'
import {
    beginPasskeyRegistrationService,
    beginPasskeyReauthenticationService,
    deletePasskeyService,
    finishPasskeyRegistrationService,
    finishPasskeyReauthenticationService,
    getPasskeysForUserService,
    renamePasskeyService,
} from '../../../server/Auth/Passkey/passkey.service'
import {
    beginTotpSetupService,
    confirmTotpSetupService,
    disableTotpService,
    getTwoFactorStatusService,
    regenerateRecoveryCodesService,
} from '../../../server/Auth/TwoFactor/two-factor.service'
import {
    enforceSensitiveLimit,
    localizedActionFailure,
    throwLocalizedQueryError,
    type AuthActionResult,
} from '../serverHelpers'
import { changePasswordInputSchema, updateProfileImageInputSchema } from './validation'
import {
    beginPasskeyReauthenticationInputSchema,
    confirmTotpSetupInputSchema,
    disableTotpInputSchema,
    emptySecurityInputSchema,
    finishPasskeyRegistrationInputSchema,
    finishPasskeyReauthenticationInputSchema,
    removePasskeyInputSchema,
    renamePasskeyInputSchema,
    reauthenticatePasswordInputSchema,
} from './validation'

export const changePasswordHandler = createServerFn({ method: 'POST' })
    .validator(changePasswordInputSchema)
    .handler(async ({ data }): Promise<AuthActionResult> => {
        try {
            await requirePermissionService(PERMISSIONS.ACCOUNT_UPDATE)
            const result = await changeCurrentPasswordService({
                currentPassword: data.currentPassword,
                password: data.password,
            })
            return result.success
                ? { success: true, message: 'account.password.success.changed' }
                : { success: false, message: 'account.password.error.incorrectCurrentPassword' }
        } catch (error) {
            return localizedActionFailure(error, 'account.password.error.update')
        }
    })

export const updateProfileImageHandler = createServerFn({ method: 'POST' })
    .validator(updateProfileImageInputSchema)
    .handler(async ({ data }): Promise<AuthActionResult> => {
        try {
            await requirePermissionService(PERMISSIONS.ACCOUNT_UPDATE)
            await updateCurrentProfileImageService(data.imageDataUrl)
            return { success: true, message: 'account.profileImage.success.updated' }
        } catch (error) {
            return localizedActionFailure(error, 'account.profileImage.error.update')
        }
    })

export const getSecurityStatusHandler = createServerFn({ method: 'GET' }).handler(async () => {
    try {
        const session = await requireSessionService()
        await requireSessionPermission(session, PERMISSIONS.ACCOUNT_VIEW)
        const [twoFactor, userPasskeys] = await Promise.all([
            getTwoFactorStatusService(session.user.id),
            getPasskeysForUserService(session.user.id),
        ])
        return {
            ...twoFactor,
            passkeys: userPasskeys.map((passkey) => ({
                createdAt: passkey.createdAt.toISOString(),
                id: passkey.id,
                lastUsedAt: passkey.lastUsedAt?.toISOString() ?? null,
                name: passkey.name,
            })),
            recentlyAuthenticated: isSessionRecentlyAuthenticated(session),
        }
    } catch (error) {
        throwLocalizedQueryError(error, 'account.security.error.unavailable')
    }
})

export const beginTotpSetupHandler = createServerFn({ method: 'POST' })
    .validator(emptySecurityInputSchema)
    .handler(async () => {
        try {
            const session = await requireSessionService()
            await enforceSensitiveLimit('setup', session.user.email)
            const result = await beginTotpSetupService(session)
            return {
                challengeId: result.flowId,
                message: 'account.twoFactor.success.setupStarted',
                otpAuthUrl: result.otpAuthUri,
                secret: result.secret,
                success: true as const,
            }
        } catch (error) {
            return localizedActionFailure(error, 'account.twoFactor.error.setupStart')
        }
    })

export const confirmTotpSetupHandler = createServerFn({ method: 'POST' })
    .validator(confirmTotpSetupInputSchema)
    .handler(async ({ data }) => {
        try {
            const session = await requireSessionService()
            await enforceSensitiveLimit('setup', session.user.email)
            const result = await confirmTotpSetupService({
                currentSession: session,
                flowId: data.challengeId,
                token: data.code,
            })
            return result.success
                ? {
                      message: 'account.twoFactor.success.enabled',
                      recoveryCodes: result.recoveryCodes,
                      success: true as const,
                  }
                : {
                      message: 'account.twoFactor.error.invalidCode',
                      success: false as const,
                  }
        } catch (error) {
            return localizedActionFailure(error, 'account.twoFactor.error.verify')
        }
    })

export const disableTotpHandler = createServerFn({ method: 'POST' })
    .validator(disableTotpInputSchema)
    .handler(async () => {
        try {
            const session = await requireSessionService()
            const success = await disableTotpService(session)
            return {
                success,
                message: success
                    ? 'account.twoFactor.success.disabled'
                    : 'account.twoFactor.error.notEnabled',
            }
        } catch (error) {
            return localizedActionFailure(error, 'account.twoFactor.error.disable')
        }
    })

export const regenerateRecoveryCodesHandler = createServerFn({ method: 'POST' })
    .validator(disableTotpInputSchema)
    .handler(async () => {
        try {
            const session = await requireSessionService()
            const result = await regenerateRecoveryCodesService(session)
            return result.success
                ? {
                      message: 'account.twoFactor.success.recoveryCodesRegenerated',
                      recoveryCodes: result.recoveryCodes,
                      success: true as const,
                  }
                : { message: 'account.twoFactor.error.notEnabled', success: false as const }
        } catch (error) {
            return localizedActionFailure(error, 'account.twoFactor.error.recoveryCodes')
        }
    })

export const beginPasskeyRegistrationHandler = createServerFn({ method: 'POST' })
    .validator(emptySecurityInputSchema)
    .handler(async () => {
        try {
            const session = await requireSessionService()
            await enforceSensitiveLimit('setup', session.user.email)
            const result = await beginPasskeyRegistrationService(session)
            return {
                challengeId: result.flowId,
                message: 'account.passkeys.success.registrationStarted',
                options: result.options,
                success: true as const,
            }
        } catch (error) {
            return localizedActionFailure(error, 'account.passkeys.error.registrationStart')
        }
    })

export const finishPasskeyRegistrationHandler = createServerFn({ method: 'POST' })
    .validator(finishPasskeyRegistrationInputSchema)
    .handler(async ({ data }) => {
        try {
            const session = await requireSessionService()
            await enforceSensitiveLimit('setup', session.user.email)
            const result = await finishPasskeyRegistrationService({
                currentSession: session,
                flowId: data.challengeId,
                ...(data.name ? { name: data.name } : {}),
                response: data.response as unknown as RegistrationResponseJSON,
            })
            return {
                success: result.success,
                message: result.success
                    ? 'account.passkeys.success.added'
                    : 'account.passkeys.error.registrationVerification',
            }
        } catch (error) {
            return localizedActionFailure(error, 'account.passkeys.error.registrationComplete')
        }
    })

export const renamePasskeyHandler = createServerFn({ method: 'POST' })
    .validator(renamePasskeyInputSchema)
    .handler(async ({ data }) => {
        try {
            const session = await requireSessionService()
            const success = await renamePasskeyService({
                currentSession: session,
                name: data.name,
                passkeyId: data.passkeyId,
            })
            return {
                success,
                message: success
                    ? 'account.passkeys.success.renamed'
                    : 'account.passkeys.error.notFound',
            }
        } catch (error) {
            return localizedActionFailure(error, 'account.passkeys.error.rename')
        }
    })

export const removePasskeyHandler = createServerFn({ method: 'POST' })
    .validator(removePasskeyInputSchema)
    .handler(async ({ data }) => {
        try {
            const session = await requireSessionService()
            const success = await deletePasskeyService({
                currentSession: session,
                passkeyId: data.passkeyId,
            })
            return {
                success,
                message: success
                    ? 'account.passkeys.success.removed'
                    : 'account.passkeys.error.notFound',
            }
        } catch (error) {
            return localizedActionFailure(error, 'account.passkeys.error.remove')
        }
    })

export const reauthenticatePasswordHandler = createServerFn({ method: 'POST' })
    .validator(reauthenticatePasswordInputSchema)
    .handler(async ({ data }) => {
        try {
            const session = await requireSessionService()
            await enforceSensitiveLimit('login', session.user.email)
            const success = await reauthenticateCurrentSessionWithPasswordService(
                session,
                data.credential,
            )
            return {
                success,
                message: success
                    ? 'account.reauthentication.success.confirmed'
                    : 'account.reauthentication.error.incorrectPassword',
            }
        } catch (error) {
            return localizedActionFailure(error, 'account.reauthentication.error.failed')
        }
    })

export const beginPasskeyReauthenticationHandler = createServerFn({ method: 'POST' })
    .validator(beginPasskeyReauthenticationInputSchema)
    .handler(async () => {
        try {
            const session = await requireSessionService()
            await enforceSensitiveLimit('login', session.user.email)
            const result = await beginPasskeyReauthenticationService(session)
            return {
                challengeId: result.flowId,
                message: 'account.reauthentication.success.passkeyStarted',
                options: result.options,
                success: true as const,
            }
        } catch (error) {
            return localizedActionFailure(error, 'account.reauthentication.error.passkeyStart')
        }
    })

export const finishPasskeyReauthenticationHandler = createServerFn({ method: 'POST' })
    .validator(finishPasskeyReauthenticationInputSchema)
    .handler(async ({ data }) => {
        try {
            const session = await requireSessionService()
            await enforceSensitiveLimit('login', session.user.email)
            const result = await finishPasskeyReauthenticationService({
                currentSession: session,
                flowId: data.challengeId,
                response: data.response as unknown as AuthenticationResponseJSON,
            })
            return {
                success: result.success,
                message: result.success
                    ? 'account.reauthentication.success.confirmed'
                    : 'account.reauthentication.error.passkeyVerification',
            }
        } catch (error) {
            return localizedActionFailure(error, 'account.reauthentication.error.failed')
        }
    })

function notFoundProfileImageResponse(): Response {
    return new Response(null, {
        status: 404,
        headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    })
}
export const getProfileImageResponse = createServerOnlyFn(
    async (input: { readonly request: Request; readonly userId: string }): Promise<Response> => {
        const versionValue = new URL(input.request.url).searchParams.get(
            PROFILE_IMAGE_VERSION_QUERY_KEY,
        )
        const version = versionValue ? Number(versionValue) : Number.NaN
        try {
            const asset = await getProfileImageAssetService(input.userId, version)
            if (!asset) return notFoundProfileImageResponse()
            return new Response(new Uint8Array(asset.bytes).buffer, {
                headers: {
                    'Cache-Control': 'private, max-age=31536000, immutable',
                    'Content-Length': String(asset.bytes.byteLength),
                    'Content-Type': 'image/webp',
                    Vary: 'Cookie',
                    'X-Content-Type-Options': 'nosniff',
                },
            })
        } catch {
            return notFoundProfileImageResponse()
        }
    },
)
