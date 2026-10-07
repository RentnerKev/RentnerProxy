import { InputProvider } from '@rentnerkev/inputs'
import { SelectProvider } from '@rentnerkev/select'
import { Outlet } from '@tanstack/react-router'

import AuthenticatedShell from './Components/ApplicationShell/index.tsx'
import ThemeModeSwitch from '@/shared/Theme/index.tsx'
import ToastPortal from '@/shared/Notifications/ToastPortal.tsx'
import CertificateJobProgressObserver from '@/features/Admin/ProxyHostManagement/CertificateJobs/CertificateJobProgressObserver.tsx'
import type { AuthenticatedRouteLayoutProps } from './Types/authenticated-route-layout.types.ts'

import useAuthenticatedLayoutLogic from './Hooks/useAuthenticatedLayoutLogic.ts'

export default function AuthenticatedLayout({ user }: AuthenticatedRouteLayoutProps) {
    const { state, handler } = useAuthenticatedLayoutLogic(user)

    return (
        <>
            <CertificateJobProgressObserver permissions={user.permissions} />
            <InputProvider locale={state.language} messages={state.inputMessages}>
                <SelectProvider
                    locale="en"
                    messages={state.selectMessages}
                    searchable={false}
                    {...(state.selectNonce ? { nonce: state.selectNonce } : {})}
                >
                    <AuthenticatedShell
                        key={user.id}
                        user={user}
                        navigationGroupPreferences={state.navigationGroupPreferences}
                        onNavigationGroupChange={handler.handleNavigationGroupChange}
                        isLoggingOut={state.isLoggingOut}
                        onLogout={handler.handleLogout}
                        themeMode={state.themeMode}
                        themeControl={
                            <ThemeModeSwitch
                                isSaving={state.isSavingTheme}
                                onToggle={handler.handleToggleTheme}
                                themeMode={state.themeMode}
                            />
                        }
                    >
                        <Outlet />
                    </AuthenticatedShell>
                </SelectProvider>
            </InputProvider>
            <ToastPortal
                locale={state.language === 'de' ? 'de' : 'en'}
                messages={state.toastMessages}
            />
        </>
    )
}
