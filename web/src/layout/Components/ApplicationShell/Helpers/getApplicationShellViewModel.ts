import { PERMISSIONS } from '../../../../config/permissions.config'
import type { Translate } from '../../../../language/useTranslationStore'
import type {
    ApplicationShellViewModel,
    ApplicationUserSummary,
} from '../Types/application-shell.types'

export default function getApplicationShellViewModel(
    user: ApplicationUserSummary,
    t: Translate,
): ApplicationShellViewModel {
    const permissionSet = new Set(user.permissions)
    const navigationItems: ApplicationShellViewModel['navigationItems'] = [
        { to: '/', label: t('shell.overview'), exact: true },
        ...(permissionSet.has(PERMISSIONS.PROXY_HOSTS_VIEW)
            ? ([{ to: '/proxy-hosts', label: t('shell.proxyHosts') }] as const)
            : []),
        ...(permissionSet.has(PERMISSIONS.REDIRECT_HOSTS_VIEW)
            ? ([{ to: '/redirect-hosts', label: t('shell.redirectHosts') }] as const)
            : []),
        ...(permissionSet.has(PERMISSIONS.CERTIFICATES_VIEW) ||
        permissionSet.has(PERMISSIONS.TRUSTED_CAS_VIEW)
            ? ([{ to: '/certificates', label: t('shell.certificates') }] as const)
            : []),
        ...(permissionSet.has(PERMISSIONS.USERS_VIEW)
            ? ([{ to: '/users', label: t('shell.users') }] as const)
            : []),
        ...(permissionSet.has(PERMISSIONS.ROLES_VIEW)
            ? ([{ to: '/roles', label: t('shell.roles') }] as const)
            : []),
    ]

    return {
        canViewAccount: permissionSet.has(PERMISSIONS.ACCOUNT_VIEW),
        navigationItems,
    }
}
