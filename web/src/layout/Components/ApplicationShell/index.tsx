import { Link } from '@tanstack/react-router'

import useTranslationStore from '../../../language/useTranslationStore'

import ApplicationNavigation from './Components/ApplicationNavigation'
import ApplicationSidebarScrollIndicator from './Components/ApplicationSidebarScrollIndicator'
import ApplicationSidebarSurface from './Components/ApplicationSidebarSurface'
import ApplicationTopbar from './Components/ApplicationTopbar'
import ApplicationUserPanel from './Components/ApplicationUserPanel'
import ApplicationVersion from './Components/ApplicationVersion'
import getApplicationShellViewModel from './Helpers/getApplicationShellViewModel'
import useApplicationNavigationLogic from './Hooks/useApplicationNavigationLogic'
import useApplicationSidebarRefs from './Hooks/useApplicationSidebarRefs'
import type { AuthenticatedShellProps } from './Types/application-shell.types'

export default function AuthenticatedShell({
    children,
    isLoggingOut,
    onLogout,
    themeControl,
    themeMode,
    user,
}: AuthenticatedShellProps) {
    const { t } = useTranslationStore()
    const { sidebarRef, sidebarScrollRef } = useApplicationSidebarRefs()
    const navigation = useApplicationNavigationLogic()
    const viewModel = getApplicationShellViewModel(user, t)

    return (
        <div
            className={`grid min-h-screen min-w-0 bg-canvas text-ink transition-[grid-template-columns,background-color,color] duration-[180ms] motion-reduce:transition-none ${
                navigation.state.isNavigationExpanded
                    ? 'shell:grid-cols-[19rem_minmax(0,1fr)]'
                    : 'shell:grid-cols-[0_minmax(0,1fr)]'
            }`}
            data-theme={themeMode}
        >
            <aside
                ref={sidebarRef}
                id="application-navigation"
                className={`relative z-30 isolate hidden min-w-0 flex-col overflow-hidden text-white opacity-100 transition-opacity duration-[180ms] motion-reduce:transition-none shell:fixed shell:inset-y-0 shell:left-0 shell:w-[19rem] shell:box-border ${
                    navigation.state.isNavigationExpanded
                        ? 'shell:flex'
                        : 'shell:pointer-events-none shell:flex shell:opacity-0'
                }`}
                aria-hidden={!navigation.state.isNavigationExpanded}
                inert={!navigation.state.isNavigationExpanded}
            >
                <ApplicationSidebarSurface />
                <div className="relative z-20 flex h-full min-h-0 flex-1 flex-col gap-6 overflow-hidden pt-7 pr-[2.75rem] pb-1 pl-[1.35rem] shell:[-webkit-mask-image:linear-gradient(#fff,#fff),url('/application-sidebar-surface-desktop.svg')] shell:[-webkit-mask-position:left,right] shell:[-webkit-mask-repeat:no-repeat,no-repeat] shell:[-webkit-mask-size:calc(100%_-_5rem)_100%,5rem_100%] shell:[mask-image:linear-gradient(#fff,#fff),url('/application-sidebar-surface-desktop.svg')] shell:[mask-position:left,right] shell:[mask-repeat:no-repeat,no-repeat] shell:[mask-size:calc(100%_-_5rem)_100%,5rem_100%]">
                    <Link
                        to="/"
                        className="block w-fit max-w-[14rem] shrink-0 cursor-pointer rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-400"
                        aria-label={t('shell.overviewLink')}
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
                        className="mr-5 h-px shrink-0 bg-gradient-to-r from-brand-500 via-brand-500/65 to-transparent"
                        aria-hidden="true"
                    />
                    <div
                        id="application-navigation-links"
                        ref={sidebarScrollRef}
                        className="-mr-11 ml-[-1.35rem] min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pr-11 pl-[1.35rem] scrollbar-none [&::-webkit-scrollbar]:hidden"
                    >
                        <ApplicationNavigation items={viewModel.navigationItems} />
                    </div>
                    <ApplicationUserPanel
                        canViewAccount={viewModel.canViewAccount}
                        isLoggingOut={isLoggingOut}
                        onLogout={onLogout}
                        user={user}
                    />
                    <ApplicationVersion />
                </div>
                <ApplicationSidebarScrollIndicator
                    scrollContainerRef={sidebarScrollRef}
                    sidebarRef={sidebarRef}
                />
            </aside>

            <div className="min-w-0 shell:col-start-2">
                <div className="sticky top-0 z-40 shell:contents">
                    <ApplicationTopbar
                        isMobileNavigationOpen={navigation.state.isMobileNavigationOpen}
                        isNavigationExpanded={navigation.state.isNavigationExpanded}
                        mobileNavigationToggleLabel={navigation.state.mobileNavigationToggleLabel}
                        navigationToggleLabel={navigation.state.navigationToggleLabel}
                        onToggleMobileNavigation={navigation.handler.toggleMobileNavigation}
                        onToggleNavigation={navigation.handler.toggleNavigation}
                        themeControl={themeControl}
                    />
                    <div
                        id="application-mobile-navigation"
                        className={
                            navigation.state.isMobileNavigationOpen
                                ? 'absolute inset-x-0 top-full z-50 flex h-[calc(100dvh-100%)] min-h-0 flex-col overflow-hidden border-b border-border-strong bg-navy-950 text-white shadow-2xl shell:hidden'
                                : 'hidden'
                        }
                        inert={!navigation.state.isMobileNavigationOpen}
                    >
                        {navigation.state.isMobileNavigationOpen ? (
                            <>
                                <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-3">
                                    <ApplicationNavigation
                                        items={viewModel.navigationItems}
                                        onNavigate={navigation.handler.closeMobileNavigation}
                                    />
                                </div>
                                <ApplicationUserPanel
                                    canViewAccount={viewModel.canViewAccount}
                                    isLoggingOut={isLoggingOut}
                                    onLogout={onLogout}
                                    onNavigate={navigation.handler.closeMobileNavigation}
                                    user={user}
                                />
                                <div className="shrink-0 bg-navy-950 px-7 pt-2 pb-3">
                                    <ApplicationVersion />
                                </div>
                            </>
                        ) : null}
                    </div>
                </div>
                <main className="mx-auto box-border w-full max-w-[90rem] px-[clamp(1.25rem,4vw,3.5rem)] py-[clamp(1.25rem,4vw,3.5rem)]">
                    {children}
                </main>
            </div>
        </div>
    )
}

export type { AuthenticatedShellProps } from './Types/application-shell.types'
