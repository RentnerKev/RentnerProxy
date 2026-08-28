import { Outlet, createFileRoute } from '@tanstack/react-router'

import { requireAuthenticatedRoute } from '../../features/Auth/route-guards'
import useLogoutLogic from '../../features/Auth/Session/Hooks/useLogoutLogic'
import useThemeModeLogic from '../../features/Theme/Hooks/useThemeModeLogic'
import AuthenticatedShell from '../../shared/ApplicationShell/AuthenticatedShell'
import type { AuthenticatedUser } from '../../shared/Types/auth.types'

export const Route = createFileRoute('/_authenticated')({
    beforeLoad: requireAuthenticatedRoute,
    component: AuthenticatedLayout,
})

function AuthenticatedLayout() {
    const { user } = Route.useRouteContext()

    return <AuthenticatedSessionLayout key={user.id} user={user} />
}

function AuthenticatedSessionLayout({ user }: { readonly user: AuthenticatedUser }) {
    const { handler, state } = useLogoutLogic()
    const theme = useThemeModeLogic(user.themeMode)

    return (
        <AuthenticatedShell
            user={user}
            isLoggingOut={state.isLoggingOut}
            isThemeModeSaving={theme.state.isSaving}
            onLogout={handler.handleLogout}
            onThemeModeToggle={theme.handler.handleToggle}
            themeMode={theme.state.themeMode}
            themeModeError={theme.state.errorMessage}
        >
            <Outlet />
        </AuthenticatedShell>
    )
}
