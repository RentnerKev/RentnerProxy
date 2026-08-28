import { Link } from '@tanstack/react-router'

import { PERMISSIONS } from '../../config/permissions.config'
import ThemeModeSwitch from '../../features/Theme/Components/ThemeModeSwitch'
import { uiClassNames } from '../Styles/uiClassNames'
import type { AuthenticatedShellProps } from './Types/application-shell.types'

const baseItems = [{ to: '/', label: 'Overview', exact: true }] as const
const accountIcon = (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 20 20">
        <circle cx="10" cy="6.5" r="3" />
        <path d="M4.75 16c.55-3.05 2.3-4.55 5.25-4.55s4.7 1.5 5.25 4.55" />
    </svg>
)
const logoutIcon = (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 20 20">
        <path d="M8.25 3.25H5.5A1.75 1.75 0 0 0 3.75 5v10A1.75 1.75 0 0 0 5.5 16.75h2.75" />
        <path d="M11.75 6.5 15.25 10l-3.5 3.5M7.25 10h8" />
    </svg>
)

const navigationLinkClassName =
    'inline-flex flex-none items-center gap-[0.65rem] rounded-[0.65rem] border border-transparent px-3 py-[0.65rem] text-[0.85rem] font-[750] text-mist-300 no-underline transition-[background-color,border-color,color] duration-150 hover:border-brand-500/20 hover:bg-brand-500/10 hover:text-white motion-reduce:transition-none [&>span]:size-[0.42rem] [&>span]:rounded-full [&>span]:bg-mist-500'

const activeNavigationLinkClassName = `${navigationLinkClassName} border-brand-500/20 bg-brand-500/10 text-white [&>span]:bg-brand-500 [&>span]:shadow-[0_0_0_4px_rgb(48_238_97_/_12%)]`

export default function AuthenticatedShell({
    children,
    isLoggingOut,
    isThemeModeSaving,
    onLogout,
    onThemeModeToggle,
    themeMode,
    themeModeError,
    user,
}: AuthenticatedShellProps) {
    const permissionSet = new Set(user.permissions)
    const managementItems = [
        permissionSet.has(PERMISSIONS.USERS_VIEW) ? { to: '/users', label: 'Users' } : null,
        permissionSet.has(PERMISSIONS.ROLES_VIEW) ? { to: '/roles', label: 'Roles' } : null,
    ].filter((item): item is { to: '/users' | '/roles'; label: string } => item !== null)

    return (
        <div
            className="grid min-h-screen min-w-0 bg-canvas text-ink transition-[background-color,color] duration-[180ms] motion-reduce:transition-none shell:grid-cols-[17rem_minmax(0,1fr)]"
            data-theme={themeMode}
        >
            <aside className="relative flex flex-col gap-5 overflow-hidden bg-navy-950 bg-[radial-gradient(circle_at_10%_0%,rgba(48,238,97,0.13),transparent_14rem)] p-4 text-white shell:sticky shell:top-0 shell:h-screen shell:box-border shell:gap-6 shell:px-[1.35rem] shell:py-7">
                <Link
                    to="/"
                    className="block w-fit max-w-[13rem] rounded-xl shell:max-w-[14rem]"
                    aria-label="RentnerProxy overview"
                >
                    <img
                        src="/rentnerproxy-logo-long.png"
                        alt=""
                        width={220}
                        height={80}
                        className="block h-auto w-full"
                    />
                </Link>

                <div
                    className="h-px bg-gradient-to-r from-brand-500 to-transparent"
                    aria-hidden="true"
                />

                <nav
                    aria-label="Application navigation"
                    className="flex gap-[0.4rem] overflow-x-auto pb-1 shell:grid shell:overflow-visible"
                >
                    <p
                        className={`${uiClassNames.technicalLabel} mb-[0.6rem] ml-3 hidden shell:block`}
                    >
                        Control plane
                    </p>
                    {[...baseItems, ...managementItems].map((item) => (
                        <Link
                            key={item.to}
                            to={item.to}
                            activeOptions={{ exact: 'exact' in item ? item.exact : false }}
                            className={navigationLinkClassName}
                            activeProps={{
                                className: activeNavigationLinkClassName,
                            }}
                        >
                            <span aria-hidden="true" />
                            {item.label}
                        </Link>
                    ))}
                </nav>

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
                        {permissionSet.has(PERMISSIONS.ACCOUNT_VIEW) ? (
                            <Link
                                to="/account"
                                className="inline-flex min-w-0 min-h-[2.35rem] items-center justify-center gap-[0.45rem] rounded-[0.7rem] border border-white/10 bg-white/[0.04] px-[0.6rem] py-[0.45rem] text-[0.72rem] font-extrabold text-mist-300 no-underline transition-[transform,background-color,color,border-color] duration-150 hover:-translate-y-px hover:border-brand-500/30 hover:bg-brand-500/10 hover:text-[#eaffef] motion-reduce:transition-none [&>svg]:size-4 [&>svg]:flex-none [&>svg]:fill-none [&>svg]:stroke-current [&>svg]:stroke-[1.65] [&>svg]:[stroke-linecap:round] [&>svg]:[stroke-linejoin:round] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300"
                            >
                                {accountIcon}
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
                            {logoutIcon}
                            {isLoggingOut ? 'Signing out…' : 'Logout'}
                        </button>
                    </div>
                </div>
            </aside>

            <div className="min-w-0">
                <header className="flex min-h-14 items-center justify-between gap-4 border-b border-border bg-topbar px-5 py-[0.8rem] font-mono text-[0.62rem] font-bold tracking-[0.08em] text-muted uppercase shell:sticky shell:top-0 shell:z-20 shell:px-8 shell:backdrop-blur-[16px]">
                    <p className="m-0 flex items-center gap-[0.55rem] max-[639px]:hidden">
                        <span
                            className="size-2 rounded-full bg-brand-500 shadow-[0_0_0_4px_rgb(48_238_97_/_12%)]"
                            aria-hidden="true"
                        />
                        Authenticated session
                    </p>
                    <div className="flex min-w-0 items-center gap-4 max-[639px]:w-full max-[639px]:justify-between">
                        <p className="m-0 max-w-[min(28vw,22rem)] overflow-hidden text-ellipsis whitespace-nowrap max-[639px]:max-w-[45vw]">
                            {user.roles.join(' · ')}
                        </p>
                        <ThemeModeSwitch
                            errorMessage={themeModeError}
                            isSaving={isThemeModeSaving}
                            onToggle={onThemeModeToggle}
                            themeMode={themeMode}
                        />
                    </div>
                </header>
                <main className="mx-auto box-border w-full max-w-[90rem] px-[clamp(1.25rem,4vw,3.5rem)] py-[clamp(1.25rem,4vw,3.5rem)]">
                    {children}
                </main>
            </div>
        </div>
    )
}
