import { createFileRoute } from '@tanstack/react-router'

import { PERMISSIONS } from '../../config/permissions.config'
import UserSettingsPage from '../../features/UserSettings'
import { requirePermissionRoute } from '../../features/Auth/route-guards'
import { getUserSettingsSearch } from '../../features/UserSettings/Helpers/userSettingsPage'
import useUserSettingsRoute from '../../features/UserSettings/Hooks/useUserSettingsRoute'

export const Route = createFileRoute('/_authenticated/account')({
    beforeLoad: requirePermissionRoute(PERMISSIONS.ACCOUNT_VIEW),
    validateSearch: getUserSettingsSearch,
    component: AccountRoute,
})

function AccountRoute() {
    const { user, activeSection } = useUserSettingsRoute()

    return <UserSettingsPage user={user} activeSection={activeSection} />
}
