import { createFileRoute } from '@tanstack/react-router'

import LoginPage from '@/features/Auth/Login/index.tsx'
import { oidcFeedbackCodeSchema } from '@/lib/Auth/Oidc/validation.ts'
import type { OidcFeedbackCode } from '@/lib/Auth/Oidc/Types/oidc-feedback.types.ts'

export const Route = createFileRoute('/_public/login/')({
    validateSearch: (search: Record<string, unknown>): { oidcError?: OidcFeedbackCode } => {
        const feedback = oidcFeedbackCodeSchema.safeParse(search.oidcError)
        return feedback.success ? { oidcError: feedback.data } : {}
    },
    component: LoginPage,
})
