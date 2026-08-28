import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useRouter } from '@tanstack/react-router'

import { logoutHandler } from '../../server'

export default function useLogoutLogic() {
    const navigate = useNavigate()
    const router = useRouter()
    const queryClient = useQueryClient()
    const mutation = useMutation({
        mutationFn: () => logoutHandler(),
        onSettled: async () => {
            queryClient.clear()
            await router.invalidate()
            await navigate({ to: '/login', replace: true })
        },
    })

    return {
        state: { isLoggingOut: mutation.isPending },
        handler: { handleLogout: () => mutation.mutate() },
    }
}
