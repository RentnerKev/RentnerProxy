import type {
    GlobalErrorPageLogicResult,
    UseGlobalErrorPageLogicParams,
} from '../Types/system-state-page.types.ts'
import { useRouter } from '@tanstack/react-router'

import { getPageErrorDetails } from '@/lib/Errors/pageError.ts'

export default function useGlobalErrorPageLogic({
    error,
    reset,
}: UseGlobalErrorPageLogicParams): GlobalErrorPageLogicResult {
    const router = useRouter()
    const details = getPageErrorDetails(error)

    return {
        state: { details },
        handler: {
            retry: () => {
                if (details.reload) {
                    window.location.reload()
                    return
                }
                reset()
                void router.invalidate()
            },
        },
    }
}
