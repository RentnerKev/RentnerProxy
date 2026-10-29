import { InputProvider } from '@rentnerkev/inputs'
import { SelectProvider } from '@rentnerkev/select'
import { ToastProvider } from '@rentnerkev/toasts'
import { Outlet } from '@tanstack/react-router'
import { Activity } from 'react'

import AuthenticatedShell from './Components/ApplicationShell/index.tsx'
import ThemeModeSwitch from '@/shared/Theme/index.tsx'
import { TOAST_PROVIDER_PROPS } from '@/config/toast.config.ts'
import CertificateJobProgressObserver from '@/features/Admin/ProxyHostManagement/CertificateJobs/CertificateJobProgressObserver.tsx'
import type { AuthenticatedRouteLayoutProps } from './Types/authenticated-route-layout.types.ts'
import PageAlertsProvider from '@/shared/PageAlerts/PageAlertsProvider.tsx'
import QuickActionsProvider from '@/shared/QuickActions/Components/QuickActionsProvider.tsx'

import useAuthenticatedLayoutLogic from './Hooks/useAuthenticatedLayoutLogic.ts'

export default function AuthenticatedLayout({ user }: AuthenticatedRouteLayoutProps) {
    const { state, handler } = useAuthenticatedLayoutLogic(user)
    return (
        <>
            {state.isIdentityPending ? (
                <main
                    role={state.hasIdentityError ? 'alert' : 'status'}
                    className="grid min-h-screen place-content-center gap-4 bg-navy-950 p-8 text-white"
                >
                    <p>
                        {state.hasIdentityError
                            ? state.identityErrorMessage
                            : state.identityLoadingMessage}
                    </p>
                    {state.hasIdentityError ? (
                        <button
                            type="button"
                            className="rounded-xl bg-accent px-5 py-3 font-bold text-accent-foreground"
                            onClick={handler.handleRetryIdentity}
                        >
                            {state.retryLabel}
                        </button>
                    ) : null}
                </main>
            ) : null}
            <Activity
                mode={state.isIdentityPending ? 'hidden' : 'visible'}
                key={state.identityGeneration}
            >
                <div hidden={state.isIdentityPending} inert={state.isIdentityPending}>
                    <PageAlertsProvider key={user.id}>
                        <CertificateJobProgressObserver permissions={user.permissions} />
                        <InputProvider locale={state.language} messages={state.inputMessages}>
                            <SelectProvider
                                locale="en"
                                messages={state.selectMessages}
                                searchable={false}
                                {...(state.selectNonce ? { nonce: state.selectNonce } : {})}
                            >
                                <QuickActionsProvider key={user.id} permissions={user.permissions}>
                                    <AuthenticatedShell
                                        key={user.id}
                                        user={user}
                                        navigationGroupPreferences={
                                            state.navigationGroupPreferences
                                        }
                                        onNavigationGroupChange={
                                            handler.handleNavigationGroupChange
                                        }
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
                                </QuickActionsProvider>
                            </SelectProvider>
                        </InputProvider>
                        <ToastProvider
                            {...TOAST_PROVIDER_PROPS}
                            locale={state.language === 'de' ? 'de' : 'en'}
                            messages={state.toastMessages}
                        >
                            {null}
                        </ToastProvider>
                    </PageAlertsProvider>
                </div>
            </Activity>
        </>
    )
}
