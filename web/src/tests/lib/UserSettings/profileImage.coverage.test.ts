import { expect, mock, spyOn, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import {
    createCroppedProfileImageDataUrl,
    createProfileImageSource,
} from '@/lib/UserSettings/profileImage.ts'
import {
    PROFILE_IMAGE_CLIENT_OUTPUT_SIZE,
    PROFILE_IMAGE_MAX_SOURCE_BYTES,
} from '@/config/profile-image.config.ts'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()

test('profile image sources enforce format, byte and decoded-pixel bounds and revoke every rejected object URL', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'Image')
    let width = 100
    let height = 80
    let unreadable = false
    class FixtureImage extends EventTarget {
        naturalWidth = width
        naturalHeight = height
        decoding = ''
        set src(_value: string) {
            queueMicrotask(() => this.dispatchEvent(new Event(unreadable ? 'error' : 'load')))
        }
    }
    Object.defineProperty(globalThis, 'Image', { configurable: true, value: FixtureImage })
    const create = spyOn(URL, 'createObjectURL').mockReturnValue('blob:fixture')
    const revoke = spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    try {
        await expect(
            createProfileImageSource(new File(['x'], 'bad.txt', { type: 'text/plain' })),
        ).rejects.toThrow('unsupportedType')
        await expect(
            createProfileImageSource(new File([], 'empty.png', { type: 'image/png' })),
        ).rejects.toThrow('fileTooLarge')
        const oversized = new File(['x'], 'large.png', { type: 'image/png' })
        Object.defineProperty(oversized, 'size', { value: PROFILE_IMAGE_MAX_SOURCE_BYTES + 1 })
        await expect(createProfileImageSource(oversized)).rejects.toThrow('fileTooLarge')
        expect(create).not.toHaveBeenCalled()
        const file = new File(['fixture'], 'image.png', { type: 'image/png' })
        expect(await createProfileImageSource(file)).toBe('blob:fixture')
        expect(revoke).not.toHaveBeenCalled()
        width = 63
        await expect(createProfileImageSource(file)).rejects.toThrow('invalidDimensions')
        width = 100
        height = 63
        await expect(createProfileImageSource(file)).rejects.toThrow('invalidDimensions')
        width = 10000
        height = 10000
        await expect(createProfileImageSource(file)).rejects.toThrow('invalidDimensions')
        width = 100
        height = 80
        unreadable = true
        await expect(createProfileImageSource(file)).rejects.toThrow('unreadable')
        expect(revoke).toHaveBeenCalledTimes(4)
        expect(revoke.mock.calls.every(([url]) => url === 'blob:fixture')).toBe(true)
    } finally {
        create.mockRestore()
        revoke.mockRestore()
        if (original) Object.defineProperty(globalThis, 'Image', original)
    }
})

test('cropping clamps decoded geometry, emits a fixed WebP output and rejects unsupported canvas and reader failures', async () => {
    const imageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Image')
    const readerDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'FileReader')
    let readerMode: 'success' | 'binary' | 'error' = 'success'
    let nullBlob = false
    const drawn = mock((..._arguments: unknown[]) => {})
    const context = { drawImage: drawn, imageSmoothingEnabled: false, imageSmoothingQuality: 'low' }
    class FixtureImage extends EventTarget {
        naturalWidth = 100
        naturalHeight = 80
        decoding = ''
        set src(_value: string) {
            queueMicrotask(() => this.dispatchEvent(new Event('load')))
        }
    }
    class FixtureReader extends EventTarget {
        result: string | ArrayBuffer | null = null
        readAsDataURL(blob: Blob) {
            expect(blob.type).toBe('image/webp')
            this.result =
                readerMode === 'binary' ? new ArrayBuffer(1) : 'data:image/webp;base64,YQ=='
            queueMicrotask(() =>
                this.dispatchEvent(new Event(readerMode === 'error' ? 'error' : 'load')),
            )
        }
    }
    Object.defineProperty(globalThis, 'Image', { configurable: true, value: FixtureImage })
    Object.defineProperty(globalThis, 'FileReader', { configurable: true, value: FixtureReader })
    const getContext = spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
        context as unknown as CanvasRenderingContext2D,
    )
    const toBlob = spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
        this: HTMLCanvasElement,
        callback,
        type,
        quality,
    ) {
        expect(this.width).toBe(PROFILE_IMAGE_CLIENT_OUTPUT_SIZE)
        expect(this.height).toBe(PROFILE_IMAGE_CLIENT_OUTPUT_SIZE)
        expect(type).toBe('image/webp')
        expect(quality).toBe(0.92)
        queueMicrotask(() =>
            callback(nullBlob ? null : new Blob(['fixture'], { type: 'image/webp' })),
        )
    })
    try {
        expect(
            await createCroppedProfileImageDataUrl('blob:fixture', {
                x: -9,
                y: 79.6,
                width: 200,
                height: 20,
            }),
        ).toBe('data:image/webp;base64,YQ==')
        expect(drawn).toHaveBeenCalledWith(expect.any(FixtureImage), 0, 79, 100, 1, 0, 0, 512, 512)
        expect(context.imageSmoothingEnabled).toBe(true)
        expect(context.imageSmoothingQuality).toBe('high')
        await expect(
            createCroppedProfileImageDataUrl('blob:fixture', { x: 0, y: 0, width: 0, height: 20 }),
        ).rejects.toThrow('invalidCrop')
        getContext.mockReturnValueOnce(null)
        await expect(
            createCroppedProfileImageDataUrl('blob:fixture', { x: 0, y: 0, width: 20, height: 20 }),
        ).rejects.toThrow('unsupportedBrowser')
        nullBlob = true
        await expect(
            createCroppedProfileImageDataUrl('blob:fixture', { x: 0, y: 0, width: 20, height: 20 }),
        ).rejects.toThrow('cropCreation')
        nullBlob = false
        readerMode = 'binary'
        await expect(
            createCroppedProfileImageDataUrl('blob:fixture', { x: 0, y: 0, width: 20, height: 20 }),
        ).rejects.toThrow('cropRead')
        readerMode = 'error'
        await expect(
            createCroppedProfileImageDataUrl('blob:fixture', { x: 0, y: 0, width: 20, height: 20 }),
        ).rejects.toThrow('cropRead')
    } finally {
        getContext.mockRestore()
        toBlob.mockRestore()
        if (imageDescriptor) Object.defineProperty(globalThis, 'Image', imageDescriptor)
        if (readerDescriptor) Object.defineProperty(globalThis, 'FileReader', readerDescriptor)
    }
})
