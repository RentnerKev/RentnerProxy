import { UserRound } from 'lucide-react'

import useTranslationStore from '../../../language/useTranslationStore'

import { Tooltip } from '../../Tooltip'
import { getUserAvatarUrl } from '../Helpers/userAvatar'
import useUserAvatarLogic from '../Hooks/useUserAvatarLogic'
import type { UserAvatarProps, UserAvatarSize } from '../Types/avatar.types'

const sizeClassNames: Record<UserAvatarSize, string> = {
    sm: 'size-9 [&>span>svg]:size-[1.05rem]',
    md: 'size-10 [&>span>svg]:size-[1.15rem]',
    lg: 'size-24 [&>span>svg]:size-8',
}

export default function UserAvatar({
    displayName,
    profileImageVersion,
    size = 'md',
    userId,
}: UserAvatarProps) {
    const { t } = useTranslationStore()
    const src = getUserAvatarUrl(userId, profileImageVersion)
    const logic = useUserAvatarLogic(src)

    return (
        <Tooltip content={t('common.profilePicture', { name: displayName })}>
            <span
                className={`relative grid shrink-0 place-items-center overflow-hidden rounded-full border border-brand-500/30 bg-brand-500/10 text-brand-300 shadow-[0_0_0_3px_rgb(15_179_58_/_6%)] ${sizeClassNames[size]}`}
                aria-hidden="true"
            >
                <span className="absolute inset-0 grid place-items-center">
                    <UserRound aria-hidden="true" strokeWidth={1.8} />
                </span>
                {logic.showImage && src ? (
                    <img
                        src={src}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="absolute inset-0 size-full object-cover"
                        onError={logic.handleError}
                    />
                ) : null}
            </span>
        </Tooltip>
    )
}
