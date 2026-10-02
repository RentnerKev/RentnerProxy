import { createFileRoute } from '@tanstack/react-router'

import AuthenticatedRouteLayout from '@/layouts/AuthenticatedLayout/index.tsx'
import { requireAuthenticatedRoute } from '@/features/Auth/route-guards.ts'
import {
    AuthenticatedLanguageProvider,
    loadLanguageBootstrap,
} from '@/shared/Language/Hooks/useTranslationStore.ts'

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
            <AuthenticatedRouteLayout user={user} />
        </AuthenticatedLanguageProvider>
    )
}
