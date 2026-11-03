import { expect, mock, spyOn, test } from 'bun:test'
import type { ChangeEvent } from 'react'
import { mountHook } from '@/tests/features/UserSettings/hookCoverageSupport.ts'

const invalidate = mock(async () => {})
const open = mock(async (_file: File) => 'blob:fixture-image')
const crop = mock(async (_source: string, _area: unknown) => 'data:image/png;base64,YQ==')
let rejected = false
const save = mock(async (_input: unknown) => ({ success: !rejected, message: 'image-saved' }))
const success = mock(() => {})
const error = mock(() => {})
mock.module('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate }) }))
mock.module('@/shared/Language/Hooks/useTranslationStore.ts', () => ({
    default: () => ({ t: (key: string) => key }),
}))
mock.module('@rentnerkev/toasts', () => ({ toast: { success, error } }))
mock.module('@/features/UserSettings/middleware.ts', () => ({ updateProfileImageHandler: save }))
mock.module('@/lib/UserSettings/profileImage.ts', () => ({
    createProfileImageSource: open,
    createCroppedProfileImageDataUrl: crop,
}))
const { default: useProfileImageLogic } =
    await import('@/features/UserSettings/Components/ProfileImagePanel/Hooks/useProfileImageLogic.ts')

function fileEvent(file: File | null) {
    const input = document.createElement('input')
    Object.defineProperty(input, 'files', { value: { item: () => file } })
    return { currentTarget: input } as ChangeEvent<HTMLInputElement>
}

test('profile editor validates preparation, coalesces save, keeps rejected edits and releases blob URLs', async () => {
    const revoke = spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const hook = await mountHook(useProfileImageLogic)
    try {
        await hook.run(() => hook.value.handler.handleSave())
        expect(save).not.toHaveBeenCalled()
        await hook.run(() => hook.value.handler.handleFileChange(fileEvent(null)))
        expect(open).not.toHaveBeenCalled()
        open.mockRejectedValueOnce(new Error('account.profileImage.error.invalidType'))
        await hook.run(() =>
            hook.value.handler.handleFileChange(fileEvent(new File(['x'], 'bad.txt'))),
        )
        expect(error).toHaveBeenCalledWith('account.profileImage.error.invalidType', {
            title: 'toast.titles.error',
        })
        await hook.run(() =>
            hook.value.handler.handleFileChange(fileEvent(new File(['x'], 'photo.png'))),
        )
        expect(hook.value.state.isOpen).toBe(true)
        expect(hook.value.state.canSave).toBe(false)
        const area = { x: 0, y: 0, width: 32, height: 32 }
        await hook.run(() => hook.value.handler.handleCropComplete(area, area))
        await hook.run(() => hook.value.handler.handleCropChange({ x: 2, y: 3 }))
        await hook.run(() => hook.value.handler.handleZoomChange(2))
        expect(hook.value.state.crop).toEqual({ x: 2, y: 3 })
        await hook.run(() =>
            hook.value.handler.handleZoomInput({
                currentTarget: { value: '3' },
            } as ChangeEvent<HTMLInputElement>),
        )
        expect(hook.value.state.zoom).toBe(3)
        await hook.run(() => hook.value.handler.handleResetCrop())
        expect(hook.value.state.zoom).toBe(1)
        expect(hook.value.state.crop).toEqual({ x: 0, y: 0 })
        rejected = true
        await hook.run(() => hook.value.handler.handleSave())
        expect(hook.value.state.isOpen).toBe(true)
        expect(save).toHaveBeenCalledWith({ data: { imageDataUrl: 'data:image/png;base64,YQ==' } })
        expect(invalidate).not.toHaveBeenCalled()
        crop.mockRejectedValueOnce(new Error('unexpected image failure'))
        await hook.run(() => hook.value.handler.handleSave())
        expect(error).toHaveBeenCalledWith('account.profileImage.error.update', {
            title: 'toast.titles.error',
        })
        rejected = false
        let release: ((value: string) => void) | undefined
        crop.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    release = resolve
                }),
        )
        let pending: Promise<void> | undefined
        await hook.run(() => {
            pending = hook.value.handler.handleSave()
            void hook.value.handler.handleSave()
        })
        expect(hook.value.state.isPending).toBe(true)
        await hook.run(() => hook.value.handler.handleOpenChange(false))
        expect(hook.value.state.isOpen).toBe(true)
        await hook.run(async () => {
            release?.('data:image/png;base64,YQ==')
            await pending
        })
        expect(invalidate).toHaveBeenCalledTimes(1)
        expect(hook.value.state.isOpen).toBe(false)
        expect(hook.value.state.isPending).toBe(false)
        expect(revoke).toHaveBeenCalledWith('blob:fixture-image')
        await hook.run(() =>
            hook.value.handler.handleFileChange(fileEvent(new File(['x'], 'photo.png'))),
        )
        await hook.run(() => hook.value.handler.handleOpenChange(false))
        expect(hook.value.state.imageSrc).toBeNull()
    } finally {
        rejected = false
        await hook.dispose()
        revoke.mockRestore()
    }
})
