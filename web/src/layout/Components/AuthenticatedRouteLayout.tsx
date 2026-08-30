import { Outlet } from '@tanstack/react-router'

import AuthenticatedShell from './ApplicationShell'
import ThemeModeSwitch from './Theme'
import useThemeModeLogic from './Theme/Hooks/useThemeModeLogic'
import useLogoutLogic from '../../features/Auth/Session/Hooks/useLogoutLogic'
import type { AuthenticatedRouteLayoutProps } from '../Types/authenticated-route-layout.types'

export default function AuthenticatedRouteLayout({ user }: AuthenticatedRouteLayoutProps) {
    const { handler, state } = useLogoutLogic()
    const theme = useThemeModeLogic(user.themeMode)

    return (
        <AuthenticatedShell
            user={user}
            isLoggingOut={state.isLoggingOut}
            onLogout={handler.handleLogout}
            themeMode={theme.state.themeMode}
            themeControl={
                <ThemeModeSwitch
                    isSaving={theme.state.isSaving}
                    onToggle={theme.handler.handleToggle}
                    themeMode={theme.state.themeMode}
                />
            }
        >
            <Outlet />
        </AuthenticatedShell>
    )
}
