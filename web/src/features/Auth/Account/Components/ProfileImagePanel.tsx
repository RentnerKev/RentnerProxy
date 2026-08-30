import { Camera, ImageUp } from 'lucide-react'

import { UserAvatar } from '../../../../shared/Avatar'
import FormMessage from '../../../../shared/Forms/FormMessage'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import { PROFILE_IMAGE_ACCEPT } from '../../../../config/profile-image.config'
import useTranslationStore from '../../../../language/useTranslationStore'
import useProfileImageLogic from '../Hooks/useProfileImageLogic'
import type { ProfileImagePanelProps } from '../Types/account-component-props.types'
import ProfileImageCropDialog from './ProfileImageCropDialog'

export default function ProfileImagePanel({ canUpdateProfileImage, user }: ProfileImagePanelProps) {
    const logic = useProfileImageLogic()
    const { t } = useTranslationStore()

    return (
        <section className={uiClassNames.management.card} aria-labelledby="profile-image-title">
            <p className={uiClassNames.themedTechnicalLabel}>
                {t('account.profileImage.sectionEyebrow')}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-4">
                <UserAvatar
                    displayName={user.displayName}
                    profileImageVersion={user.profileImageVersion}
                    size="lg"
                    userId={user.id}
                />
                <div className="min-w-0 flex-1">
                    <h2 id="profile-image-title" className="text-xl text-ink-soft">
                        {t('account.profileImage.title')}
                    </h2>
                    <p className="mt-1 text-sm leading-relaxed text-muted">
                        {t('account.profileImage.description')}
                    </p>
                </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3">
                <label
                    className={`${uiClassNames.button.secondary} relative overflow-hidden has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-[0.55]`}
                >
                    {user.profileImageVersion ? (
                        <Camera aria-hidden="true" className="size-4" />
                    ) : (
                        <ImageUp aria-hidden="true" className="size-4" />
                    )}
                    {user.profileImageVersion
                        ? t('account.profileImage.change')
                        : t('account.profileImage.choose')}
                    <input
                        type="file"
                        accept={PROFILE_IMAGE_ACCEPT}
                        className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                        onChange={logic.handler.handleFileChange}
                        disabled={!canUpdateProfileImage || logic.state.isPending}
                        aria-label={t('account.profileImage.inputLabel')}
                    />
                </label>
                <span className="text-xs text-muted">{t('account.profileImage.maximumSize')}</span>
            </div>
            {!canUpdateProfileImage ? (
                <FormMessage tone="info">account.profileImage.noPermission</FormMessage>
            ) : null}
            {logic.state.errorMessage && !logic.state.isOpen ? (
                <FormMessage tone="error">{logic.state.errorMessage}</FormMessage>
            ) : null}
            {logic.state.successMessage ? (
                <FormMessage tone="success">{logic.state.successMessage}</FormMessage>
            ) : null}
            <ProfileImageCropDialog logic={logic} />
        </section>
    )
}
