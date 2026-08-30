import { createFileRoute } from '@tanstack/react-router'

import AuthenticatedRouteLayout from '../../layout/Components/AuthenticatedRouteLayout'
import ToastProvider from '../../shared/Toast/Components/ToastProvider'
import { requireAuthenticatedRoute } from '../../features/Auth/route-guards'
import {
    AuthenticatedLanguageProvider,
    loadLanguageBootstrap,
} from '../../language/useTranslationStore'

export const Route = createFileRoute('/_authenticated')({
    beforeLoad: requireAuthenticatedRoute,
    loader: ({ context }) => loadLanguageBootstrap(context.user.language),
    component: AuthenticatedLayout,
})

function AuthenticatedLayout() {
    const { user } = Route.useRouteContext()
    const bootstrap = Route.useLoaderData()

    return (
        <AuthenticatedLanguageProvider key={user.id} bootstrap={bootstrap}>
            <ToastProvider>
                <AuthenticatedRouteLayout user={user} />
            </ToastProvider>
        </AuthenticatedLanguageProvider>
    )
}
