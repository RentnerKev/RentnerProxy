import { createFileRoute, redirect } from '@tanstack/react-router'

import { PERMISSIONS } from '../../config/permissions.config'
import AccountPage from '../../features/Auth/Account'

export const Route = createFileRoute('/_authenticated/account')({
    beforeLoad: ({ context }) => {
        if (!context.user.permissions.includes(PERMISSIONS.ACCOUNT_VIEW)) {
            throw redirect({ to: '/' })
        }
    },
    component: AccountRoute,
})

function AccountRoute() {
    const { user } = Route.useRouteContext()

    return <AccountPage user={user} />
}
