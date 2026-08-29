import { Link } from '@tanstack/react-router'
import { LogOut, UserRound } from 'lucide-react'

import type { ApplicationUserPanelProps } from '../Types/application-shell.types'

export default function ApplicationUserPanel({
    canViewAccount,
    isLoggingOut,
    onLogout,
    user,
}: ApplicationUserPanelProps) {
    return (
        <div className="flex flex-wrap items-center justify-between gap-[0.9rem] rounded-2xl border border-white/10 bg-white/[0.03] p-[0.9rem] shadow-[inset_0_1px_0_rgb(255_255_255_/_3%)] shell:mt-auto shell:grid">
            <div className="grid min-w-0 gap-[0.2rem]">
                <span className="overflow-hidden text-[0.82rem] font-extrabold text-ellipsis whitespace-nowrap">
                    {user.displayName}
                </span>
                <small className="overflow-hidden text-[0.68rem] text-mist-400 text-ellipsis whitespace-nowrap">
                    {user.email}
                </small>
            </div>
            <div className="grid w-full grid-cols-2 gap-[0.45rem] [&>:only-child]:col-span-full shell:flex shell:justify-between">
                {canViewAccount ? (
                    <Link
                        to="/account"
                        className="inline-flex min-w-0 min-h-[2.35rem] items-center justify-center gap-[0.45rem] rounded-[0.7rem] border border-white/10 bg-white/[0.04] px-[0.6rem] py-[0.45rem] text-[0.72rem] font-extrabold text-mist-300 no-underline transition-[transform,background-color,color,border-color] duration-150 hover:-translate-y-px hover:border-brand-500/30 hover:bg-brand-500/10 hover:text-[#eaffef] motion-reduce:transition-none [&>svg]:size-4 [&>svg]:flex-none [&>svg]:fill-none [&>svg]:stroke-current [&>svg]:stroke-[1.65] [&>svg]:[stroke-linecap:round] [&>svg]:[stroke-linejoin:round] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300"
                    >
                        <UserRound aria-hidden="true" />
                        Account
                    </Link>
                ) : null}
                <button
                    type="button"
                    className="inline-flex min-w-0 min-h-[2.35rem] items-center justify-center gap-[0.45rem] rounded-[0.7rem] border border-red-400/30 bg-red-700/15 px-[0.6rem] py-[0.45rem] text-[0.72rem] font-extrabold text-red-300 transition-[transform,background-color,color,border-color] duration-150 enabled:hover:-translate-y-px enabled:hover:border-red-300/50 enabled:hover:bg-red-700/25 enabled:hover:text-red-100 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-300 disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none [&>svg]:size-4 [&>svg]:flex-none [&>svg]:fill-none [&>svg]:stroke-current [&>svg]:stroke-[1.65] [&>svg]:[stroke-linecap:round] [&>svg]:[stroke-linejoin:round]"
                    onClick={onLogout}
                    disabled={isLoggingOut}
                    aria-busy={isLoggingOut}
                >
                    <LogOut aria-hidden="true" />
                    {isLoggingOut ? 'Signing out…' : 'Logout'}
                </button>
            </div>
        </div>
    )
}
