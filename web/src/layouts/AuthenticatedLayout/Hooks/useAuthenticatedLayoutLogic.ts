import useLogout from '@/features/Auth/Session/Hooks/useLogout.ts'
import { getClientCspNonce } from '@/lib/Security/cspNonce.ts'
import useApplicationLiveSync from '@/shared/Live/Hooks/useApplicationLiveSync.ts'
import useThemeMode from '@/shared/Theme/Hooks/useThemeMode.ts'
import type { AuthenticatedUser } from '@/lib/Auth/Types/auth.types.ts'
import { toast } from '@rentnerkev/toasts/toast'
import { useEffect } from 'react'
import useControlLocalization from '@/layouts/RootLayout/Hooks/useControlLocalization.ts'
import type { AuthenticatedLayoutLogicResult } from '../Types/authenticated-layout-logic.types.ts'
import useNavigationGroupPreferences from './useNavigationGroupPreferences.ts'

export default function useAuthenticatedLayoutLogic(
    user: AuthenticatedUser,
): AuthenticatedLayoutLogicResult {
    useApplicationLiveSync()
    useEffect(() => () => toast.dismissAll(), [])
    const logout = useLogout()
    const theme = useThemeMode(user.themeMode)
    const navigationGroups = useNavigationGroupPreferences(user)
    const { language, t, inputMessages, selectMessages } = useControlLocalization()

    return {
        state: {
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
            handleLogout: logout.handler.handleLogout,
            handleToggleTheme: theme.handler.handleToggle,
            handleNavigationGroupChange: navigationGroups.updateGroup,
        },
    }
}
