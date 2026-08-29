import '@tanstack/react-start/server-only'

import { Buffer } from 'node:buffer'

import {
    PROFILE_IMAGE_MAX_DATA_URL_LENGTH,
    PROFILE_IMAGE_MAX_INPUT_PIXELS,
    PROFILE_IMAGE_MAX_WEBP_BYTES,
    PROFILE_IMAGE_SERVER_OUTPUT_SIZE,
} from '../../../config/profile-image.config'
import { AuthDomainError, isAuthDomainError } from '../Core/errors.server'

const PROFILE_IMAGE_DATA_URL_PATTERN =
    /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/
const PROFILE_IMAGE_INPUT_FORMATS = new Set<Bun.Image.Format>(['jpeg', 'png', 'webp'])
const MINIMUM_PROFILE_IMAGE_EDGE = 64

function decodeProfileImageDataUrl(dataUrl: string): Uint8Array {
    if (dataUrl.length > PROFILE_IMAGE_MAX_DATA_URL_LENGTH) {
        throw new AuthDomainError('invalid_input', 'The profile image is too large.')
    }

    const encoded = PROFILE_IMAGE_DATA_URL_PATTERN.exec(dataUrl)?.[1]

    if (!encoded || encoded.length % 4 !== 0) {
        throw new AuthDomainError('invalid_input', 'The profile image is invalid.')
    }

    const bytes = Buffer.from(encoded, 'base64')

    if (bytes.toString('base64') !== encoded) {
        throw new AuthDomainError('invalid_input', 'The profile image is invalid.')
    }

    return bytes
}

export async function createNormalizedProfileImageWebp(dataUrl: string): Promise<Uint8Array> {
    try {
        const bytes = decodeProfileImageDataUrl(dataUrl)
        const image = new Bun.Image(bytes, {
            autoOrient: true,
            maxPixels: PROFILE_IMAGE_MAX_INPUT_PIXELS,
        })
        const metadata = await image.metadata()

        if (
            !PROFILE_IMAGE_INPUT_FORMATS.has(metadata.format) ||
            metadata.width !== metadata.height ||
            metadata.width < MINIMUM_PROFILE_IMAGE_EDGE
        ) {
            throw new AuthDomainError(
                'invalid_input',
                'The profile image must be a square JPEG, PNG, or WebP image.',
            )
        }

        const webp = await image
            .resize(PROFILE_IMAGE_SERVER_OUTPUT_SIZE, PROFILE_IMAGE_SERVER_OUTPUT_SIZE, {
                filter: 'lanczos3',
                fit: 'fill',
            })
            .webp({ quality: 82 })
            .bytes()

        if (webp.byteLength > PROFILE_IMAGE_MAX_WEBP_BYTES) {
            throw new AuthDomainError('invalid_input', 'The profile image is too complex.')
        }

        return webp
    } catch (error) {
        if (isAuthDomainError(error)) {
            throw error
        }

        throw new AuthDomainError('invalid_input', 'The profile image could not be decoded.')
    }
}
