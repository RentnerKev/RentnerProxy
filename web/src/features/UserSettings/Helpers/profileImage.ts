import type { Area } from 'react-easy-crop'

import {
    PROFILE_IMAGE_ACCEPTED_MIME_TYPES,
    PROFILE_IMAGE_CLIENT_OUTPUT_SIZE,
    PROFILE_IMAGE_MAX_SOURCE_BYTES,
    PROFILE_IMAGE_MAX_SOURCE_PIXELS,
} from '../../../config/profile-image.config'

function loadImageElement(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image()
        image.decoding = 'async'
        image.addEventListener('load', () => resolve(image), { once: true })
        image.addEventListener(
            'error',
            () => reject(new Error('account.profileImage.error.unreadable')),
            { once: true },
        )
        image.src = src
    })
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (blob) {
                    resolve(blob)
                    return
                }

                reject(new Error('account.profileImage.error.cropCreation'))
            },
            'image/webp',
            0.92,
        )
    })
}

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.addEventListener(
            'load',
            () =>
                typeof reader.result === 'string'
                    ? resolve(reader.result)
                    : reject(new Error('account.profileImage.error.cropRead')),
            { once: true },
        )
        reader.addEventListener(
            'error',
            () => reject(new Error('account.profileImage.error.cropRead')),
            { once: true },
        )
        reader.readAsDataURL(blob)
    })
}

function getClampedCrop(image: HTMLImageElement, crop: Area): Area {
    const x = Math.max(0, Math.min(Math.round(crop.x), image.naturalWidth - 1))
    const y = Math.max(0, Math.min(Math.round(crop.y), image.naturalHeight - 1))
    const width = Math.min(Math.round(crop.width), image.naturalWidth - x)
    const height = Math.min(Math.round(crop.height), image.naturalHeight - y)

    if (width < 1 || height < 1) {
        throw new Error('account.profileImage.error.invalidCrop')
    }

    return { height, width, x, y }
}

export async function createProfileImageSource(file: File): Promise<string> {
    if (
        !PROFILE_IMAGE_ACCEPTED_MIME_TYPES.includes(
            file.type as (typeof PROFILE_IMAGE_ACCEPTED_MIME_TYPES)[number],
        )
    ) {
        throw new Error('account.profileImage.error.unsupportedType')
    }

    if (file.size < 1 || file.size > PROFILE_IMAGE_MAX_SOURCE_BYTES) {
        throw new Error('account.profileImage.error.fileTooLarge')
    }

    const src = URL.createObjectURL(file)

    try {
        const image = await loadImageElement(src)
        const pixels = image.naturalWidth * image.naturalHeight

        if (
            image.naturalWidth < 64 ||
            image.naturalHeight < 64 ||
            pixels > PROFILE_IMAGE_MAX_SOURCE_PIXELS
        ) {
            throw new Error('account.profileImage.error.invalidDimensions')
        }

        return src
    } catch (error) {
        URL.revokeObjectURL(src)
        throw error
    }
}

export async function createCroppedProfileImageDataUrl(
    imageSrc: string,
    crop: Area,
): Promise<string> {
    const image = await loadImageElement(imageSrc)
    const clampedCrop = getClampedCrop(image, crop)
    const canvas = document.createElement('canvas')
    canvas.width = PROFILE_IMAGE_CLIENT_OUTPUT_SIZE
    canvas.height = PROFILE_IMAGE_CLIENT_OUTPUT_SIZE
    const context = canvas.getContext('2d')

    if (!context) {
        throw new Error('account.profileImage.error.unsupportedBrowser')
    }

    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(
        image,
        clampedCrop.x,
        clampedCrop.y,
        clampedCrop.width,
        clampedCrop.height,
        0,
        0,
        PROFILE_IMAGE_CLIENT_OUTPUT_SIZE,
        PROFILE_IMAGE_CLIENT_OUTPUT_SIZE,
    )

    return blobToDataUrl(await canvasToBlob(canvas))
}
