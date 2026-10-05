import { Link } from '@tanstack/react-router'

import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import BrandRasterImage from '@/shared/Branding/BrandRasterImage.tsx'

import ApplicationNavigation from './Components/ApplicationNavigation/index.tsx'
import ApplicationSidebarScrollIndicator from './Components/ApplicationSidebarScrollIndicator/index.tsx'
import ApplicationSidebarSurface from './Components/ApplicationSidebarSurface.tsx'
import ApplicationTopbar from './Components/ApplicationTopbar.tsx'
import ApplicationUserPanel from './Components/ApplicationUserPanel.tsx'
import ApplicationVersion from './Components/ApplicationVersion.tsx'
import useApplicationShellLogic from './Hooks/useApplicationShellLogic.ts'
import QuickSearch from '@/features/QuickSearch/index.tsx'
import type { AuthenticatedShellProps } from './Types/application-shell.types.ts'

export default function AuthenticatedShell({
    children,
    isLoggingOut,
    navigationGroupPreferences,
    onNavigationGroupChange,
    onLogout,
    themeControl,
    themeMode,
    user,
}: AuthenticatedShellProps) {
    const { t } = useTranslationStore()
    const {
        state,
        handler,
        refs: { sidebar: sidebarRef, sidebarScroll: sidebarScrollRef },
    } = useApplicationShellLogic(user)

    return (
        <div
            className={`grid min-h-screen min-w-0 bg-canvas text-ink transition-[grid-template-columns,background-color,color] duration-180 motion-reduce:transition-none ${
                state.isNavigationExpanded
                    ? 'shell:grid-cols-[19rem_minmax(0,1fr)]'
                    : 'shell:grid-cols-[0_minmax(0,1fr)]'
            }`}
            data-theme={themeMode}
        >
            <aside
                ref={sidebarRef}
                id="application-navigation"
                className={`relative z-30 isolate hidden min-w-0 flex-col overflow-hidden text-white opacity-100 transition-opacity duration-180 motion-reduce:transition-none shell:fixed shell:inset-y-0 shell:left-0 shell:w-76 shell:box-border ${
                    state.isNavigationExpanded
                        ? 'shell:flex'
                        : 'shell:pointer-events-none shell:flex shell:opacity-0'
                }`}
                aria-hidden={!state.isNavigationExpanded}
                inert={!state.isNavigationExpanded}
            >
                <ApplicationSidebarSurface />
                <div className="relative z-20 flex h-full min-h-0 flex-1 flex-col gap-6 overflow-hidden pt-7 pr-11 pb-1 pl-[1.35rem] shell:[-webkit-mask-image:linear-gradient(#fff,#fff),url('/application-sidebar-surface-desktop.svg')] shell:[-webkit-mask-position:left,right] shell:[-webkit-mask-repeat:no-repeat,no-repeat] shell:[-webkit-mask-size:calc(100%-5rem)_100%,5rem_100%] shell:mask-[linear-gradient(#fff,#fff),url('/application-sidebar-surface-desktop.svg')] shell:mask-position-[left,right] shell:[mask-repeat:no-repeat,no-repeat] shell:mask-size-[calc(100%-5rem)_100%,5rem_100%]">
                    <Link
                        to="/"
                        className="block w-full max-w-56 shrink-0 cursor-pointer rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-400"
                        aria-label={t('shell.overviewLink')}
                    >
                        <BrandRasterImage
                            asset="logo-long"
                            alt=""
                            width={220}
                            height={80}
                            wrapperClassName="block w-full"
                        />
                    </Link>
                    <div
                        className="mr-5 h-px shrink-0 bg-linear-to-r from-brand-500 via-brand-500/65 to-transparent"
                        aria-hidden="true"
                    />
                    <div
                        id="application-navigation-links"
                        ref={sidebarScrollRef}
                        className="-mr-11 ml-[-1.35rem] min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pr-11 pl-[1.35rem] scrollbar-none [&::-webkit-scrollbar]:hidden"
                    >
                        <ApplicationNavigation
                            items={state.navigationItems}
                            groupPreferences={navigationGroupPreferences}
                            onGroupChange={onNavigationGroupChange}
                        />
                    </div>
                    <ApplicationUserPanel
                        canViewAccount={state.canViewAccount}
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
                        isMobileNavigationOpen={state.isMobileNavigationOpen}
                        isNavigationExpanded={state.isNavigationExpanded}
                        mobileNavigationToggleLabel={state.mobileNavigationToggleLabel}
                        navigationToggleLabel={state.navigationToggleLabel}
                        onToggleMobileNavigation={handler.toggleMobileNavigation}
                        onToggleNavigation={handler.toggleNavigation}
                        themeControl={themeControl}
                        searchControl={
                            <QuickSearch
                                key={user.id}
                                userId={user.id}
                                permissions={user.permissions}
                                onNavigate={handler.closeMobileNavigation}
                            />
                        }
                    />
                    <div
                        id="application-mobile-navigation"
                        className={
                            state.isMobileNavigationOpen
                                ? 'absolute inset-x-0 top-full z-50 flex h-[calc(100dvh-100%)] min-h-0 flex-col overflow-hidden border-b border-border-strong bg-navy-950 text-white shadow-2xl shell:hidden'
                                : 'hidden'
                        }
                        inert={!state.isMobileNavigationOpen}
                    >
                        {state.isMobileNavigationOpen ? (
                            <>
                                <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-3">
                                    <ApplicationNavigation
                                        items={state.navigationItems}
                                        onNavigate={handler.closeMobileNavigation}
                                        groupPreferences={navigationGroupPreferences}
                                        onGroupChange={onNavigationGroupChange}
                                    />
                                </div>
                                <ApplicationUserPanel
                                    canViewAccount={state.canViewAccount}
                                    isLoggingOut={isLoggingOut}
                                    onLogout={onLogout}
                                    onNavigate={handler.closeMobileNavigation}
                                    user={user}
                                />
                                <div className="shrink-0 bg-navy-950 px-7 pt-2 pb-3">
                                    <ApplicationVersion />
                                </div>
                            </>
                        ) : null}
                    </div>
                </div>
                <main className="mx-auto box-border w-full max-w-360 px-[clamp(1.25rem,4vw,3.5rem)] py-[clamp(1.25rem,4vw,3.5rem)]">
                    {children}
                </main>
            </div>
        </div>
    )
}
