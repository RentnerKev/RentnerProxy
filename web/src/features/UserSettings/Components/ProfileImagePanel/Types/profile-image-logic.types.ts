import type { ChangeEvent } from 'react'
import type { Area, Point } from 'react-easy-crop'
export interface ProfileImageLogicResult {
    state: {
        canSave: boolean
        crop: Point
        imageSrc: string | null
        isOpen: boolean
        isPending: boolean
        zoom: number
    }
    handler: {
        handleCropChange: (value: Point) => void
        handleCropComplete: (area: Area, pixels: Area) => void
        handleFileChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>
        handleOpenChange: (open: boolean) => void
        handleResetCrop: () => void
        handleSave: () => Promise<void>
        handleZoomChange: (zoom: number) => void
        handleZoomInput: (event: ChangeEvent<HTMLInputElement>) => void
    }
}
