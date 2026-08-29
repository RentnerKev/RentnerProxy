import { Camera, ImageUp } from 'lucide-react'

import { UserAvatar } from '../../../../shared/Avatar'
import FormMessage from '../../../../shared/Forms/FormMessage'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import { PROFILE_IMAGE_ACCEPT } from '../../../../config/profile-image.config'
import useProfileImageLogic from '../Hooks/useProfileImageLogic'
import type { ProfileImagePanelProps } from '../Types/account-component-props.types'
import ProfileImageCropDialog from './ProfileImageCropDialog'

export default function ProfileImagePanel({ canUpdateProfileImage, user }: ProfileImagePanelProps) {
    const logic = useProfileImageLogic()

    return (
        <section className={uiClassNames.management.card} aria-labelledby="profile-image-title">
            <p className={uiClassNames.themedTechnicalLabel}>Personal image</p>
            <div className="mt-4 flex flex-wrap items-center gap-4">
                <UserAvatar
                    displayName={user.displayName}
                    profileImageVersion={user.profileImageVersion}
                    size="lg"
                    userId={user.id}
                />
                <div className="min-w-0 flex-1">
                    <h2 id="profile-image-title" className="text-xl text-ink-soft">
                        Profile picture
                    </h2>
                    <p className="mt-1 text-sm leading-relaxed text-muted">
                        Choose a JPEG, PNG, or WebP image. You can position it in a round crop
                        before saving.
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
                    {user.profileImageVersion ? 'Change picture' : 'Choose picture'}
                    <input
                        type="file"
                        accept={PROFILE_IMAGE_ACCEPT}
                        className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                        onChange={logic.handler.handleFileChange}
                        disabled={!canUpdateProfileImage || logic.state.isPending}
                        aria-label="Choose profile picture"
                    />
                </label>
                <span className="text-xs text-muted">Maximum 8 MB</span>
            </div>
            {!canUpdateProfileImage ? (
                <FormMessage tone="info">
                    You do not have permission to update this profile picture.
                </FormMessage>
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
