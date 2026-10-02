import { createFileRoute } from '@tanstack/react-router'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import UserSettingsPage from '@/features/UserSettings/index.tsx'
import { requirePermissionRoute } from '@/features/Auth/route-guards.ts'
import { getUserSettingsSearch } from '@/lib/UserSettings/userSettingsPage.ts'
import useUserSettingsRoute from '@/features/UserSettings/Hooks/useUserSettingsRoute.ts'

export const Route = createFileRoute('/_authenticated/account')({
    beforeLoad: requirePermissionRoute(PERMISSIONS.ACCOUNT_VIEW),
    validateSearch: getUserSettingsSearch,
    component: AccountRoute,
})

function AccountRoute() {
    const { user, activeSection } = useUserSettingsRoute()

    return <UserSettingsPage user={user} activeSection={activeSection} />
}
