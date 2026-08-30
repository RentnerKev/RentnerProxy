import { Check, RotateCcw, ZoomIn } from 'lucide-react'
import Cropper from 'react-easy-crop'

import { Modal } from '../../../shared/Modal'
import { uiClassNames } from '../../../shared/Styles/uiClassNames'
import useTranslationStore from '../../../language/useTranslationStore'
import type { ProfileImageCropDialogProps } from '../Types/user-settings-component-props.types'

export default function ProfileImageCropDialog({ logic }: ProfileImageCropDialogProps) {
    const { t } = useTranslationStore()

    return (
        <Modal
            open={logic.state.isOpen}
            onOpenChange={logic.handler.handleOpenChange}
            closeDisabled={logic.state.isPending}
            size="md"
            title={t('account.profileImage.crop.title')}
            description={t('account.profileImage.crop.description')}
            footer={
                <>
                    <button
                        type="button"
                        className={uiClassNames.button.secondary}
                        onClick={() => logic.handler.handleOpenChange(false)}
                        disabled={logic.state.isPending}
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        type="button"
                        className={uiClassNames.button.primary}
                        onClick={logic.handler.handleSave}
                        disabled={!logic.state.canSave}
                    >
                        <Check aria-hidden="true" className="size-4" />
                        {logic.state.isPending
                            ? t('account.profileImage.crop.saving')
                            : t('account.profileImage.crop.save')}
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
                        cropperProps={{ 'aria-label': t('account.profileImage.crop.areaLabel') }}
                    />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <label
                        className="flex min-w-52 flex-1 items-center gap-3 text-sm font-bold text-ink-soft"
                        htmlFor="profile-image-zoom"
                    >
                        <ZoomIn aria-hidden="true" className="size-4 text-brand-text" />
                        <span className="sr-only">{t('account.profileImage.crop.zoom')}</span>
                        <input
                            id="profile-image-zoom"
                            type="range"
                            min="1"
                            max="3"
                            step="0.01"
                            value={logic.state.zoom}
                            onChange={logic.handler.handleZoomInput}
                            className="h-2 flex-1 cursor-pointer accent-brand-500"
                            aria-label={t('account.profileImage.crop.zoomLabel')}
                        />
                    </label>
                    <button
                        type="button"
                        className={uiClassNames.button.quiet}
                        onClick={logic.handler.handleResetCrop}
                        disabled={logic.state.isPending}
                    >
                        <RotateCcw aria-hidden="true" className="size-4" />
                        {t('account.profileImage.crop.reset')}
                    </button>
                </div>
            </div>
        </Modal>
    )
}
