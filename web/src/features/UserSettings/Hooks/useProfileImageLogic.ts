import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import type { ChangeEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Area, Point } from 'react-easy-crop'

import { userManagementQueryKeys } from '../../Admin/UserManagement/queryKeys'
import { updateProfileImageHandler } from '../server'
import useToast from '../../../shared/Toast/Hooks/useToast'
import { createCroppedProfileImageDataUrl, createProfileImageSource } from '../Helpers/profileImage'

const INITIAL_CROP: Point = { x: 0, y: 0 }
const INITIAL_ZOOM = 1

function getProfileImageErrorKey(error: unknown, fallback: string): string {
    return error instanceof Error && error.message.startsWith('account.profileImage.error.')
        ? error.message
        : fallback
}

export default function useProfileImageLogic() {
    const toast = useToast()
    const saveInFlight = useRef(false)
    const queryClient = useQueryClient()
    const router = useRouter()
    const [imageSrc, setImageSrc] = useState<string | null>(null)
    const [crop, setCrop] = useState<Point>(INITIAL_CROP)
    const [zoom, setZoom] = useState(INITIAL_ZOOM)
    const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null)
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
        mutation.reset()
    }, [mutation])

    const handleFileChange = useCallback(
        async (event: ChangeEvent<HTMLInputElement>) => {
            const file = event.currentTarget.files?.item(0)
            event.currentTarget.value = ''

            if (!file) {
                return
            }

            try {
                setImageSrc(await createProfileImageSource(file))
                setCrop(INITIAL_CROP)
                setZoom(INITIAL_ZOOM)
                setCroppedAreaPixels(null)
            } catch (error) {
                toast.error(getProfileImageErrorKey(error, 'account.profileImage.error.open'))
            }
        },
        [toast],
    )

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
        if (!imageSrc || !croppedAreaPixels || isPending || saveInFlight.current) {
            return
        }

        saveInFlight.current = true
        mutation.reset()
        setIsPreparing(true)

        try {
            const imageDataUrl = await createCroppedProfileImageDataUrl(imageSrc, croppedAreaPixels)
            const result = await mutation.mutateAsync(imageDataUrl)

            if (!result.success) {
                toast.error(result.message)
                return
            }

            await Promise.all([
                queryClient.invalidateQueries({ queryKey: userManagementQueryKeys.all }),
                router.invalidate(),
            ])
            toast.success(result.message)
            resetEditor()
        } catch (error) {
            toast.error(getProfileImageErrorKey(error, 'account.profileImage.error.update'))
        } finally {
            saveInFlight.current = false
            setIsPreparing(false)
        }
    }, [croppedAreaPixels, imageSrc, isPending, mutation, queryClient, resetEditor, router, toast])

    return {
        state: {
            canSave: Boolean(imageSrc && croppedAreaPixels) && !isPending,
            crop,
            imageSrc,
            isOpen: imageSrc !== null,
            isPending,
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
