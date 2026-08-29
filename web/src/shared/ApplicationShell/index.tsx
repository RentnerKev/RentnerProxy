import { Link } from '@tanstack/react-router'

import ApplicationNavigation from './Components/ApplicationNavigation'
import ApplicationTopbar from './Components/ApplicationTopbar'
import ApplicationUserPanel from './Components/ApplicationUserPanel'
import getApplicationShellLayoutClassNames from './Helpers/getApplicationShellLayoutClassNames'
import getApplicationShellViewModel from './Helpers/getApplicationShellViewModel'
import useApplicationNavigationLogic from './Hooks/useApplicationNavigationLogic'
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
                <ApplicationNavigation items={viewModel.navigationItems} />
                <ApplicationUserPanel
                    canViewAccount={viewModel.canViewAccount}
                    isLoggingOut={isLoggingOut}
                    onLogout={onLogout}
                    user={user}
                />
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
