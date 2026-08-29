import { Check, RotateCcw, ZoomIn } from 'lucide-react'
import Cropper from 'react-easy-crop'

import FormMessage from '../../../../shared/Forms/FormMessage'
import { Modal } from '../../../../shared/Modal'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import type { ProfileImageCropDialogProps } from '../Types/account-component-props.types'

export default function ProfileImageCropDialog({ logic }: ProfileImageCropDialogProps) {
    return (
        <Modal
            open={logic.state.isOpen}
            onOpenChange={logic.handler.handleOpenChange}
            closeDisabled={logic.state.isPending}
            size="md"
            title="Crop profile picture"
            description="Move and zoom the image until the round preview looks right."
            footer={
                <>
                    <button
                        type="button"
                        className={uiClassNames.button.secondary}
                        onClick={() => logic.handler.handleOpenChange(false)}
                        disabled={logic.state.isPending}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className={uiClassNames.button.primary}
                        onClick={logic.handler.handleSave}
                        disabled={!logic.state.canSave}
                    >
                        <Check aria-hidden="true" className="size-4" />
                        {logic.state.isPending ? 'Saving picture…' : 'Save picture'}
                    </button>
                </>
            }
        >
            <div className="grid gap-4">
                <div className="relative h-[min(54dvh,26rem)] min-h-72 overflow-hidden rounded-2xl border border-border-strong bg-navy-950 shadow-inner">
                    <Cropper
                        image={logic.state.imageSrc ?? ''}
                        crop={logic.state.crop}
                        zoom={logic.state.zoom}
                        aspect={1}
                        cropShape="round"
                        showGrid={false}
                        minZoom={1}
                        maxZoom={3}
                        roundCropAreaPixels
                        disableAutomaticStylesInjection
                        onCropChange={logic.handler.handleCropChange}
                        onCropComplete={logic.handler.handleCropComplete}
                        onZoomChange={logic.handler.handleZoomChange}
                        classes={{
                            cropAreaClassName:
                                '!border-[3px] !border-brand-500 !shadow-[0_0_0_9999px_rgb(2_10_11_/_72%)]',
                        }}
                        mediaProps={{ alt: '' }}
                        cropperProps={{ 'aria-label': 'Profile picture crop area' }}
                    />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <label
                        className="flex min-w-52 flex-1 items-center gap-3 text-sm font-bold text-ink-soft"
                        htmlFor="profile-image-zoom"
                    >
                        <ZoomIn aria-hidden="true" className="size-4 text-brand-text" />
                        <span className="sr-only">Zoom</span>
                        <input
                            id="profile-image-zoom"
                            type="range"
                            min="1"
                            max="3"
                            step="0.01"
                            value={logic.state.zoom}
                            onChange={logic.handler.handleZoomInput}
                            className="h-2 flex-1 cursor-pointer accent-brand-500"
                            aria-label="Zoom profile picture"
                        />
                    </label>
                    <button
                        type="button"
                        className={uiClassNames.button.quiet}
                        onClick={logic.handler.handleResetCrop}
                        disabled={logic.state.isPending}
                    >
                        <RotateCcw aria-hidden="true" className="size-4" />
                        Reset position
                    </button>
                </div>
                {logic.state.errorMessage ? (
                    <FormMessage tone="error">{logic.state.errorMessage}</FormMessage>
                ) : null}
            </div>
        </Modal>
    )
}
