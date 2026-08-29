import { PERMISSIONS } from '../../../config/permissions.config'
import type {
    ApplicationShellViewModel,
    ApplicationUserSummary,
} from '../Types/application-shell.types'

export default function getApplicationShellViewModel(
    user: ApplicationUserSummary,
): ApplicationShellViewModel {
    const permissionSet = new Set(user.permissions)
    const navigationItems: ApplicationShellViewModel['navigationItems'] = [
        { to: '/', label: 'Overview', exact: true },
        ...(permissionSet.has(PERMISSIONS.USERS_VIEW)
            ? ([{ to: '/users', label: 'Users' }] as const)
            : []),
        ...(permissionSet.has(PERMISSIONS.ROLES_VIEW)
            ? ([{ to: '/roles', label: 'Roles' }] as const)
            : []),
    ]

    return {
        canViewAccount: permissionSet.has(PERMISSIONS.ACCOUNT_VIEW),
        navigationItems,
    }
}
