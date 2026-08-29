import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'

import { PERMISSIONS } from '../../../config/permissions.config'
import { PROFILE_IMAGE_VERSION_QUERY_KEY } from '../../../config/profile-image.config'
import { changeCurrentPasswordService } from '../../../server/Auth/Account/account.service'
import {
    getProfileImageAssetService,
    updateCurrentProfileImageService,
} from '../../../server/Auth/Account/profile-image.service'
import { requirePermissionService } from '../../../server/Auth/Access/authorization.service'
import { actionFailure, type AuthActionResult } from '../serverHelpers'
import { changePasswordInputSchema, updateProfileImageInputSchema } from './validation'

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

            return {
                success: true,
                message: 'Profile picture updated.',
            }
        } catch (error) {
            return actionFailure(error, 'The profile picture could not be updated.')
        }
    })

function notFoundProfileImageResponse(): Response {
    return new Response(null, {
        status: 404,
        headers: {
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
        },
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

            if (!asset) {
                return notFoundProfileImageResponse()
            }

            const body = new Uint8Array(asset.bytes).buffer

            return new Response(body, {
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
