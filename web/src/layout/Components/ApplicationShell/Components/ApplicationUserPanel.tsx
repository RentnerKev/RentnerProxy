import { Link } from '@tanstack/react-router'
import { LogOut, UserRound } from 'lucide-react'

import useTranslationStore from '../../../../language/useTranslationStore'

import { UserAvatar } from '../../../../shared/Avatar'
import type { ApplicationUserPanelProps } from '../Types/application-shell.types'

export default function ApplicationUserPanel({
    canViewAccount,
    isLoggingOut,
    onLogout,
    onNavigate,
    user,
}: ApplicationUserPanelProps) {
    const { t } = useTranslationStore()

    return (
        <div className="relative flex shrink-0 flex-wrap items-center justify-between gap-[0.9rem] overflow-hidden border-y border-white/10 bg-navy-950/80 p-[0.9rem] shadow-[inset_0_1px_0_rgb(255_255_255_/_2%)] backdrop-blur-sm shell:-mr-[2.75rem] shell:-ml-[1.35rem] shell:grid shell:pr-[4rem] shell:pl-[2.25rem]">
            <div className="flex min-w-0 items-center gap-2.5 pr-2">
                <UserAvatar
                    profileImageVersion={user.profileImageVersion}
                    size="sm"
                    userId={user.id}
                />
                <div className="grid min-w-0 gap-[0.2rem]">
                    <span className="overflow-hidden text-[0.82rem] font-extrabold text-ellipsis whitespace-nowrap">
                        {user.displayName}
                    </span>
                    <small className="overflow-hidden text-[0.68rem] text-mist-400 text-ellipsis whitespace-nowrap">
                        {user.email}
                    </small>
                </div>
            </div>
            <div className="grid w-full grid-cols-2 gap-[0.45rem] pr-1 [&>:only-child]:col-span-full shell:flex shell:justify-between">
                {canViewAccount ? (
                    <Link
                        to="/account"
                        className="inline-flex h-12 min-w-0 cursor-pointer items-center justify-center gap-[0.45rem] rounded-xl border border-white/10 bg-white/[0.04] px-[0.7rem] py-0 text-sm font-extrabold text-mist-300 no-underline transition-[background-color,color,border-color] duration-150 hover:border-brand-500/35 hover:bg-brand-500/12 hover:text-[#eaffef] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300 motion-reduce:transition-none [&>svg]:size-4 [&>svg]:shrink-0"
                        onClick={onNavigate}
                    >
                        <UserRound aria-hidden="true" />
                        {t('shell.account')}
                    </Link>
                ) : null}
                <button
                    type="button"
                    className="inline-flex h-12 min-w-0 cursor-pointer items-center justify-center gap-[0.45rem] rounded-xl border border-red-400/30 bg-red-700/15 px-[0.7rem] py-0 text-sm font-extrabold text-red-300 transition-[background-color,color,border-color] duration-150 enabled:hover:border-red-300/50 enabled:hover:bg-red-700/25 enabled:hover:text-red-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-300 disabled:cursor-not-allowed disabled:opacity-[0.55] motion-reduce:transition-none [&>svg]:size-4 [&>svg]:shrink-0"
                    onClick={onLogout}
                    disabled={isLoggingOut}
                    aria-busy={isLoggingOut}
                >
                    <LogOut aria-hidden="true" />
                    {t(isLoggingOut ? 'shell.signingOut' : 'shell.logout')}
                </button>
            </div>
        </div>
    )
}
