import { useRouter } from '@tanstack/react-router'

import { getPageErrorDetails } from '../../Helpers/pageError'

interface UseGlobalErrorPageLogicParams {
    readonly error: unknown
    readonly reset: () => void
}

export default function useGlobalErrorPageLogic({ error, reset }: UseGlobalErrorPageLogicParams) {
    const router = useRouter()
    const details = getPageErrorDetails(error)

    return {
        details,
        retry: () => {
            if (details.reload) {
                window.location.reload()
                return
            }
            reset()
            void router.invalidate()
        },
    }
}
