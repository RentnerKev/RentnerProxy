import { describe, expect, test } from 'bun:test'
import { Buffer } from 'node:buffer'
import { fileURLToPath } from 'node:url'

import {
    PROFILE_IMAGE_MAX_WEBP_BYTES,
    PROFILE_IMAGE_SERVER_OUTPUT_SIZE,
} from '../config/profile-image.config'
import { updateProfileImageInputSchema } from '../features/Auth/Account/validation'
import { createNormalizedProfileImageWebp } from '../server/Auth/Account/profile-image-processing.server'
import { getUserAvatarUrl } from '../shared/Avatar'

const squareImagePath = fileURLToPath(
    new URL('../../public/rentnerproxy-logo.png', import.meta.url),
)
const wideImagePath = fileURLToPath(
    new URL('../../public/rentnerproxy-logo-long.png', import.meta.url),
)

async function toDataUrl(path: string): Promise<string> {
    const bytes = await Bun.file(path).bytes()
    return `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`
}

describe('profile image pipeline', () => {
    test('normalizes a square browser crop to bounded 256px WebP bytes', async () => {
        const dataUrl = await toDataUrl(squareImagePath)
        expect(
            updateProfileImageInputSchema.safeParse({ imageDataUrl: dataUrl }).success,
        ).toBeTrue()

        const webp = await createNormalizedProfileImageWebp(dataUrl)
        const metadata = await new Bun.Image(webp).metadata()

        expect(metadata).toEqual({
            format: 'webp',
            height: PROFILE_IMAGE_SERVER_OUTPUT_SIZE,
            width: PROFILE_IMAGE_SERVER_OUTPUT_SIZE,
        })
        expect(webp.byteLength).toBeLessThanOrEqual(PROFILE_IMAGE_MAX_WEBP_BYTES)
    })

    test('rejects malformed and non-square payloads', async () => {
        await expect(
            createNormalizedProfileImageWebp('data:image/png;base64,not-base64'),
        ).rejects.toMatchObject({ code: 'invalid_input' })
        await expect(
            createNormalizedProfileImageWebp(await toDataUrl(wideImagePath)),
        ).rejects.toMatchObject({ code: 'invalid_input' })
    })

    test('builds only versioned avatar URLs', () => {
        const userId = '00000000-0000-4000-8000-000000000001'

        expect(getUserAvatarUrl(userId, null)).toBeNull()
        expect(getUserAvatarUrl(userId, 0)).toBeNull()
        expect(getUserAvatarUrl(userId, 3)).toBe(
            '/media/avatars/00000000-0000-4000-8000-000000000001?v=3',
        )
    })
})
