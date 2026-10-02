import { UserRound } from 'lucide-react'

import useUserAvatarLogic from '../Hooks/useUserAvatarLogic.ts'
import type { UserAvatarProps, UserAvatarSize } from '../Types/avatar.types.ts'

const sizeClassNames: Record<UserAvatarSize, string> = {
    sm: 'size-9 [&>span>svg]:size-[1.05rem]',
    md: 'size-10 [&>span>svg]:size-[1.15rem]',
    lg: 'size-24 [&>span>svg]:size-8',
}

export default function UserAvatar({ profileImageVersion, size = 'md', userId }: UserAvatarProps) {
    const { state, handler } = useUserAvatarLogic({ userId, profileImageVersion })

    return (
        <span
            className={`relative grid shrink-0 place-items-center overflow-hidden rounded-full border border-brand-500/30 bg-brand-500/10 text-brand-300 shadow-[0_0_0_3px_rgb(var(--accent-rgb)_/_6%)] ${sizeClassNames[size]}`}
            aria-hidden="true"
        >
            <span className="absolute inset-0 grid place-items-center">
                <UserRound aria-hidden="true" strokeWidth={1.8} />
            </span>
            {state.showImage && state.src ? (
                <img
                    src={state.src}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="absolute inset-0 size-full object-cover"
                    onError={handler.handleError}
                />
            ) : null}
        </span>
    )
}
