import { useCallback, useLayoutEffect, useRef } from 'react'
import { useRouter } from '@tanstack/react-router'
import type { LiveScrollPosition } from '../Types/live-scroll-restoration.types.ts'

/** Keeps transient identity checks from losing scroll when protected content is hidden. */
export default function useLiveScrollRestoration(
    pending: boolean,
    identityGeneration: number,
    verificationGeneration: number,
) {
    const router = useRouter()
    const saved = useRef<LiveScrollPosition | null>(null)
    const capture = useCallback(() => {
        if (saved.current || typeof window === 'undefined') return
        const location = router.state.location
        saved.current = {
            href: location.href,
            historyKey: location.state['__TSR_key'],
            identityGeneration,
            left: window.scrollX,
            top: window.scrollY,
        }
    }, [identityGeneration, router])

    // A fast verification can finish in one React batch without committing pending=true.
    useLayoutEffect(() => {
        if (pending || verificationGeneration === 0 || !saved.current) return
        const position = saved.current
        saved.current = null
        const location = router.state.location
        // A new principal or history entry owns its own scroll restoration.
        if (
            identityGeneration !== position.identityGeneration ||
            location.href !== position.href ||
            location.state['__TSR_key'] !== position.historyKey
        )
            return
        window.scrollTo({ left: position.left, top: position.top, behavior: 'instant' })
    }, [pending, identityGeneration, verificationGeneration, router])

    return capture
}
