import useLogout from '@/features/Auth/Session/Hooks/useLogout.ts'
import { getClientCspNonce } from '@/lib/Security/cspNonce.ts'
import useApplicationLiveSync from '@/shared/Live/Hooks/useApplicationLiveSync.ts'
import useThemeMode from '@/shared/Theme/Hooks/useThemeMode.ts'
import type { AuthenticatedUser } from '@/lib/Auth/Types/auth.types.ts'
import { toast } from '@rentnerkev/toasts'
import { useEffect } from 'react'
import useControlLocalization from '@/layouts/RootLayout/Hooks/useControlLocalization.ts'
import type { AuthenticatedLayoutLogicResult } from '../Types/authenticated-layout-logic.types.ts'
import useNavigationGroupPreferences from './useNavigationGroupPreferences.ts'
import useRestoreProgress from './useRestoreProgress.ts'

export default function useAuthenticatedLayoutLogic(
    user: AuthenticatedUser,
): AuthenticatedLayoutLogicResult {
    const restore = useRestoreProgress()
    const live = useApplicationLiveSync(restore.active)
    useEffect(() => () => toast.dismissAll(), [])
    const logout = useLogout()
    const theme = useThemeMode(user.themeMode)
    const navigationGroups = useNavigationGroupPreferences(user)
    const { language, t, inputMessages, selectMessages } = useControlLocalization()

    return {
        state: {
            restoreMaintenance: restore.maintenance,
            restoreDisconnected: restore.status !== 'connected',
            isIdentityPending: live.isIdentityPending,
            identityGeneration: live.identityGeneration,
            identityLoadingMessage: t('common.loading'),
            hasIdentityError: live.hasIdentityError,
            identityErrorMessage: t('system.error.causes.serviceUnavailable.description'),
            retryLabel: t('common.retry'),
            isLoggingOut: logout.state.isLoggingOut,
            themeMode: theme.state.themeMode,
            isSavingTheme: theme.state.isSaving,
            navigationGroupPreferences: navigationGroups.preferences,
            language,
            inputMessages,
            selectMessages,
            selectNonce: getClientCspNonce(),
            toastMessages: {
                regionLabel: t('toast.notification'),
                closeNotification: t('toast.dismiss'),
                copyError: t('toast.copyError'),
                errorCopied: t('toast.copied'),
            },
        },
        handler: {
            handleDismissRestore: restore.canDismiss ? restore.dismiss : undefined,
            handleRetryIdentity: live.retryIdentity,
            handleLogout: logout.handler.handleLogout,
            handleToggleTheme: theme.handler.handleToggle,
            handleNavigationGroupChange: navigationGroups.updateGroup,
        },
    }
}
