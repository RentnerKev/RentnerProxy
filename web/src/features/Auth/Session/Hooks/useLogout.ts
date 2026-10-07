import type { LogoutResult } from '../Types/logout.types.ts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useRouter } from '@tanstack/react-router'

import { logoutHandler } from '@/features/Auth/middleware.ts'
import { toast } from '@rentnerkev/toasts/toast'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'

export default function useLogout() {
    const navigate = useNavigate()
    const router = useRouter()
    const queryClient = useQueryClient()
    const { t } = useTranslationStore()
    const mutation = useMutation({
        mutationFn: () => logoutHandler(),
        onSuccess: async (result) => {
            queryClient.clear()
            await router.invalidate()
            await navigate({ to: '/login', replace: true })
            if (!result.success) {
                toast.warning(t('auth.logoutRevocationFailed'), {
                    title: t('toast.titles.warning'),
                })
            }
        },
        onError: () => {
            toast.error(t('auth.logoutFailed'), { title: t('toast.titles.error') })
        },
    })

    return {
        state: { isLoggingOut: mutation.isPending },
        handler: { handleLogout: () => mutation.mutate() },
    } satisfies LogoutResult
}
