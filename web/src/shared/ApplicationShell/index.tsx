import { Link } from '@tanstack/react-router'

import ApplicationNavigation from './Components/ApplicationNavigation'
import ApplicationSidebarSurface from './Components/ApplicationSidebarSurface'
import ApplicationTopbar from './Components/ApplicationTopbar'
import ApplicationUserPanel from './Components/ApplicationUserPanel'
import getApplicationShellLayoutClassNames from './Helpers/getApplicationShellLayoutClassNames'
import getApplicationShellViewModel from './Helpers/getApplicationShellViewModel'
import useApplicationNavigationLogic from './Hooks/useApplicationNavigationLogic'
import { applicationShellClassNames } from './Styles/applicationShellClassNames'
import type { AuthenticatedShellProps } from './Types/application-shell.types'

export default function AuthenticatedShell({
    children,
    isLoggingOut,
    onLogout,
    themeControl,
    themeMode,
    user,
}: AuthenticatedShellProps) {
    const navigation = useApplicationNavigationLogic()
    const viewModel = getApplicationShellViewModel(user)
    const layoutClassNames = getApplicationShellLayoutClassNames(
        navigation.state.isNavigationExpanded,
    )

    return (
        <div className={layoutClassNames.root} data-theme={themeMode}>
            <aside
                id="application-navigation"
                className={layoutClassNames.sidebar}
                aria-hidden={!navigation.state.isNavigationExpanded}
                inert={!navigation.state.isNavigationExpanded}
            >
                <ApplicationSidebarSurface />
                <div className={applicationShellClassNames.sidebar.content}>
                    <Link
                        to="/"
                        className={applicationShellClassNames.sidebar.logoLink}
                        aria-label="RentnerProxy overview"
                    >
                        <img
                            src="/rentnerproxy-logo-long.png"
                            alt=""
                            width={220}
                            height={80}
                            className={applicationShellClassNames.sidebar.logoImage}
                        />
                    </Link>
                    <div
                        className={applicationShellClassNames.sidebar.divider}
                        aria-hidden="true"
                    />
                    <ApplicationNavigation items={viewModel.navigationItems} />
                    <ApplicationUserPanel
                        canViewAccount={viewModel.canViewAccount}
                        isLoggingOut={isLoggingOut}
                        onLogout={onLogout}
                        user={user}
                    />
                </div>
            </aside>

            <div className="min-w-0">
                <ApplicationTopbar
                    isNavigationExpanded={navigation.state.isNavigationExpanded}
                    navigationToggleLabel={navigation.state.navigationToggleLabel}
                    onToggleNavigation={navigation.handler.toggleNavigation}
                    themeControl={themeControl}
                />
                <main className="mx-auto box-border w-full max-w-[90rem] px-[clamp(1.25rem,4vw,3.5rem)] py-[clamp(1.25rem,4vw,3.5rem)]">
                    {children}
                </main>
            </div>
        </div>
    )
}

export type { AuthenticatedShellProps } from './Types/application-shell.types'
