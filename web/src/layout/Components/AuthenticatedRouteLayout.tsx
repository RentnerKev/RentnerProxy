import { ToastProvider } from '@rentnerkev/toasts'
import { InputProvider } from '@rentnerkev/inputs'
import { SelectProvider } from '@rentnerkev/select'
import { Outlet } from '@tanstack/react-router'
import { createPortal } from 'react-dom'

import AuthenticatedShell from './ApplicationShell'
import ThemeModeSwitch from './Theme'
import useThemeModeLogic from './Theme/Hooks/useThemeModeLogic'
import useNavigationGroupPreferencesLogic from './ApplicationShell/Hooks/useNavigationGroupPreferencesLogic'
import { TOAST_PROVIDER_PROPS } from '../../config/toast.config'
import useLogoutLogic from '../../features/Auth/Session/Hooks/useLogoutLogic'
import CertificateJobProgressObserver from '../../features/Admin/ProxyHostManagement/CertificateJobs/CertificateJobProgressObserver'
import useControlLocalization from '../Hooks/useControlLocalization'
import useClearNotificationsOnLayoutExit from '../Hooks/useClearNotificationsOnLayoutExit'
import useApplicationLiveSync from '../../shared/Live/useApplicationLiveSync'
import { getClientCspNonce } from '../../shared/Helpers/cspNonce'
import type { AuthenticatedRouteLayoutProps } from '../Types/authenticated-route-layout.types'

export default function AuthenticatedRouteLayout({ user }: AuthenticatedRouteLayoutProps) {
    useApplicationLiveSync()
    const { handler, state } = useLogoutLogic()
    const theme = useThemeModeLogic(user.themeMode)
    const navigationGroups = useNavigationGroupPreferencesLogic(user)
    const { language, t, inputMessages, selectMessages } = useControlLocalization()
    const selectNonce = getClientCspNonce()
    useClearNotificationsOnLayoutExit()
    const messages = {
        regionLabel: t('toast.notification'),
        closeNotification: t('toast.dismiss'),
        copyError: t('toast.copyError'),
        errorCopied: t('toast.copied'),
    }

    return (
        <>
            <CertificateJobProgressObserver permissions={user.permissions} />
            <InputProvider locale={language} messages={inputMessages}>
                <SelectProvider
                    locale="en"
                    messages={selectMessages}
                    searchable={false}
                    {...(selectNonce ? { nonce: selectNonce } : {})}
                >
                    <AuthenticatedShell
                        key={user.id}
                        user={user}
                        navigationGroupPreferences={navigationGroups.preferences}
                        onNavigationGroupChange={navigationGroups.updateGroup}
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
                </SelectProvider>
            </InputProvider>
            {typeof document === 'undefined'
                ? null
                : createPortal(
                      <ToastProvider
                          {...TOAST_PROVIDER_PROPS}
                          locale={language === 'de' ? 'de' : 'en'}
                          messages={messages}
                      >
                          {null}
                      </ToastProvider>,
                      document.body,
                  )}
        </>
    )
}
