import { useRouter } from '@tanstack/react-router'

interface UseGlobalErrorPageLogicParams {
    readonly reset: () => void
}

export default function useGlobalErrorPageLogic({ reset }: UseGlobalErrorPageLogicParams) {
    const router = useRouter()

    return {
        retry: () => {
            reset()
            void router.invalidate()
        },
    }
}
