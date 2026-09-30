import { FileInput } from '@rentnerkev/inputs'
import { Camera, ImageUp } from 'lucide-react'

import { UserAvatar } from '../../../shared/Avatar'
import FormMessage from '../../../shared/Forms/FormMessage'
import { PROFILE_IMAGE_ACCEPT } from '../../../config/profile-image.config'
import useTranslationStore from '../../../language/useTranslationStore'
import useProfileImageLogic from '../Hooks/useProfileImageLogic'
import type { ProfileImagePanelProps } from '../Types/user-settings-component-props.types'
import ProfileImageCropDialog from './ProfileImageCropDialog'

export default function ProfileImagePanel({ canUpdateProfileImage, user }: ProfileImagePanelProps) {
    const logic = useProfileImageLogic()
    const { t } = useTranslationStore()

    return (
        <section
            className="min-w-0 rounded-2xl border border-border bg-surface p-[clamp(1.15rem,4vw,1.75rem)] shadow-surface"
            aria-labelledby="profile-image-title"
        >
            <p className="m-0 font-mono text-[0.68rem] font-bold tracking-[0.16em] text-accent-ring uppercase">
                {t('account.profileImage.sectionEyebrow')}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-4">
                <UserAvatar
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
                <label className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none border-border-strong bg-surface-raised text-ink-soft enabled:hover:border-accent-border enabled:hover:text-accent-ring relative overflow-hidden has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-[0.55]">
                    {user.profileImageVersion ? (
                        <Camera aria-hidden="true" className="size-4" />
                    ) : (
                        <ImageUp aria-hidden="true" className="size-4" />
                    )}
                    {user.profileImageVersion
                        ? t('account.profileImage.change')
                        : t('account.profileImage.choose')}
                    <FileInput
                        type="file"
                        accept={PROFILE_IMAGE_ACCEPT}
                        className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                        onChange={(event) => void logic.handler.handleFileChange(event)}
                        disabled={!canUpdateProfileImage || logic.state.isPending}
                        aria-label={t('account.profileImage.inputLabel')}
                    />
                </label>
                <span className="text-xs text-muted">{t('account.profileImage.maximumSize')}</span>
            </div>
            {!canUpdateProfileImage ? (
                <FormMessage tone="info">account.profileImage.noPermission</FormMessage>
            ) : null}
            <ProfileImageCropDialog logic={logic} />
        </section>
    )
}
