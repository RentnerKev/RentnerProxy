import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import type { ChangeEvent } from 'react'
import { useCallback, useEffect, useState } from 'react'
import type { Area, Point } from 'react-easy-crop'

import { userManagementQueryKeys } from '../../../Admin/UserManagement/queryKeys'
import { updateProfileImageHandler } from '../server'
import { createCroppedProfileImageDataUrl, createProfileImageSource } from '../Helpers/profileImage'

const INITIAL_CROP: Point = { x: 0, y: 0 }
const INITIAL_ZOOM = 1

export default function useProfileImageLogic() {
    const queryClient = useQueryClient()
    const router = useRouter()
    const [imageSrc, setImageSrc] = useState<string | null>(null)
    const [crop, setCrop] = useState<Point>(INITIAL_CROP)
    const [zoom, setZoom] = useState(INITIAL_ZOOM)
    const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null)
    const [selectionError, setSelectionError] = useState<string | null>(null)
    const [successMessage, setSuccessMessage] = useState<string | null>(null)
    const [isPreparing, setIsPreparing] = useState(false)
    const mutation = useMutation({
        mutationFn: (imageDataUrl: string) => updateProfileImageHandler({ data: { imageDataUrl } }),
    })
    const isPending = isPreparing || mutation.isPending

    useEffect(
        () => () => {
            if (imageSrc) {
                URL.revokeObjectURL(imageSrc)
            }
        },
        [imageSrc],
    )

    const resetEditor = useCallback(() => {
        setImageSrc(null)
        setCrop(INITIAL_CROP)
        setZoom(INITIAL_ZOOM)
        setCroppedAreaPixels(null)
        setSelectionError(null)
        mutation.reset()
    }, [mutation])

    const handleFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.currentTarget.files?.item(0)
        event.currentTarget.value = ''

        if (!file) {
            return
        }

        setSelectionError(null)
        setSuccessMessage(null)

        try {
            setImageSrc(await createProfileImageSource(file))
            setCrop(INITIAL_CROP)
            setZoom(INITIAL_ZOOM)
            setCroppedAreaPixels(null)
        } catch (error) {
            setSelectionError(
                error instanceof Error ? error.message : 'The selected image could not be opened.',
            )
        }
    }, [])

    const handleCropComplete = useCallback((_croppedArea: Area, pixels: Area) => {
        setCroppedAreaPixels(pixels)
    }, [])

    const handleZoomInput = useCallback((event: ChangeEvent<HTMLInputElement>) => {
        setZoom(Number(event.currentTarget.value))
    }, [])

    const handleResetCrop = useCallback(() => {
        setCrop(INITIAL_CROP)
        setZoom(INITIAL_ZOOM)
    }, [])

    const handleOpenChange = useCallback(
        (open: boolean) => {
            if (!open && !isPending) {
                resetEditor()
            }
        },
        [isPending, resetEditor],
    )

    const handleSave = useCallback(async () => {
        if (!imageSrc || !croppedAreaPixels || isPending) {
            return
        }

        mutation.reset()
        setSelectionError(null)
        setIsPreparing(true)

        try {
            const imageDataUrl = await createCroppedProfileImageDataUrl(imageSrc, croppedAreaPixels)
            const result = await mutation.mutateAsync(imageDataUrl)

            if (!result.success) {
                return
            }

            await Promise.all([
                queryClient.invalidateQueries({ queryKey: userManagementQueryKeys.all }),
                router.invalidate(),
            ])
            setSuccessMessage(result.message)
            resetEditor()
        } catch (error) {
            setSelectionError(
                error instanceof Error
                    ? error.message
                    : 'The profile picture could not be updated.',
            )
        } finally {
            setIsPreparing(false)
        }
    }, [croppedAreaPixels, imageSrc, isPending, mutation, queryClient, resetEditor, router])

    return {
        state: {
            canSave: Boolean(imageSrc && croppedAreaPixels) && !isPending,
            crop,
            errorMessage:
                selectionError ??
                (mutation.data && !mutation.data.success
                    ? mutation.data.message
                    : mutation.isError
                      ? 'The profile picture could not be updated.'
                      : null),
            imageSrc,
            isOpen: imageSrc !== null,
            isPending,
            successMessage,
            zoom,
        },
        handler: {
            handleCropChange: setCrop,
            handleCropComplete,
            handleFileChange,
            handleOpenChange,
            handleResetCrop,
            handleSave,
            handleZoomChange: setZoom,
            handleZoomInput,
        },
    }
}
