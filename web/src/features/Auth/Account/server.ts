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
import { actionFailure, enforceSensitiveLimit, type AuthActionResult } from '../serverHelpers'
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
                ? { success: true, message: 'Password changed. Other sessions were revoked.' }
                : { success: false, message: 'The current password is incorrect.' }
        } catch (error) {
            return actionFailure(error, 'The password could not be changed.')
        }
    })

export const updateProfileImageHandler = createServerFn({ method: 'POST' })
    .validator(updateProfileImageInputSchema)
    .handler(async ({ data }): Promise<AuthActionResult> => {
        try {
            await requirePermissionService(PERMISSIONS.ACCOUNT_UPDATE)
            await updateCurrentProfileImageService(data.imageDataUrl)
            return { success: true, message: 'Profile picture updated.' }
        } catch (error) {
            return actionFailure(error, 'The profile picture could not be updated.')
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
        throw new Error(
            actionFailure(error, 'Security settings are temporarily unavailable.').message,
            { cause: error },
        )
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
                message: 'Two-factor setup started.',
                otpAuthUrl: result.otpAuthUri,
                secret: result.secret,
                success: true as const,
            }
        } catch (error) {
            return actionFailure(error, 'Two-factor authentication could not be started.')
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
                      message: 'Two-factor authentication enabled.',
                      recoveryCodes: result.recoveryCodes,
                      success: true as const,
                  }
                : {
                      message: 'The authenticator code is invalid or expired.',
                      success: false as const,
                  }
        } catch (error) {
            return actionFailure(error, 'The authenticator code could not be verified.')
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
                    ? 'Two-factor authentication disabled.'
                    : 'Two-factor authentication is not enabled.',
            }
        } catch (error) {
            return actionFailure(error, 'Two-factor authentication could not be disabled.')
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
                      message: 'Recovery codes regenerated.',
                      recoveryCodes: result.recoveryCodes,
                      success: true as const,
                  }
                : { message: 'Two-factor authentication is not enabled.', success: false as const }
        } catch (error) {
            return actionFailure(error, 'Recovery codes could not be regenerated.')
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
                message: 'Passkey registration started.',
                options: result.options,
                success: true as const,
            }
        } catch (error) {
            return actionFailure(error, 'Passkey registration could not be started.')
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
                    ? 'Passkey added.'
                    : 'Passkey registration could not be verified.',
            }
        } catch (error) {
            return actionFailure(error, 'Passkey registration could not be completed.')
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
                message: success ? 'Passkey renamed.' : 'The passkey no longer exists.',
            }
        } catch (error) {
            return actionFailure(error, 'Passkey name could not be saved.')
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
                message: success ? 'Passkey removed.' : 'The passkey no longer exists.',
            }
        } catch (error) {
            return actionFailure(error, 'Passkey could not be removed.')
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
                message: success ? 'Identity confirmed.' : 'The password is incorrect.',
            }
        } catch (error) {
            return actionFailure(error, 'Reauthentication failed.')
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
                message: 'Passkey verification started.',
                options: result.options,
                success: true as const,
            }
        } catch (error) {
            return actionFailure(error, 'Passkey reauthentication could not be started.')
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
                message: result.success ? 'Identity confirmed.' : 'Passkey verification failed.',
            }
        } catch (error) {
            return actionFailure(error, 'Reauthentication failed.')
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
