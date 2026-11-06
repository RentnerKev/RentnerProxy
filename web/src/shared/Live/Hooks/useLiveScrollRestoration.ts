import { useCallback, useLayoutEffect, useRef } from 'react'
import { useRouter } from '@tanstack/react-router'
import type { LiveScrollPosition } from '../Types/live-scroll-restoration.types.ts'
import { LIVE_SCROLL_RESTORE_TIMEOUT_MS } from '@/config/realtime.config.ts'

/** Keeps transient identity checks from losing scroll when protected content is hidden. */
export default function useLiveScrollRestoration(
    pending: boolean,
    identityGeneration: number,
    verificationGeneration: number,
    suspended = false,
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
        if (pending || suspended || verificationGeneration === 0 || !saved.current) return
        const position = saved.current
        const lifecycle = new AbortController()
        let observer: ResizeObserver | undefined
        let timer: ReturnType<typeof setTimeout> | undefined
        let unsubscribe: (() => void) | undefined
        const intentEvents = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const
        const cleanup = () => {
            lifecycle.abort()
            observer?.disconnect()
            clearTimeout(timer)
            unsubscribe?.()
            window.removeEventListener('resize', retry)
            for (const event of intentEvents) window.removeEventListener(event, cancel, true)
        }
        const cancel = () => {
            if (lifecycle.signal.aborted) return
            saved.current = null
            cleanup()
        }
        const restore = (expired = false) => {
            if (lifecycle.signal.aborted) return
            const location = router.state.location
            // Every retry belongs to the same principal, URL and history entry.
            if (
                identityGeneration !== position.identityGeneration ||
                location.href !== position.href ||
                location.state['__TSR_key'] !== position.historyKey
            ) {
                cancel()
                return
            }
            const height = Math.max(
                document.documentElement.scrollHeight,
                document.body.scrollHeight,
            )
            const width = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
            if (
                !expired &&
                (Math.max(0, height - window.innerHeight) < position.top ||
                    Math.max(0, width - window.innerWidth) < position.left)
            )
                return
            window.scrollTo({ left: position.left, top: position.top, behavior: 'instant' })
            saved.current = null
            cleanup()
        }
        const retry = () => restore()
        restore()
        if (lifecycle.signal.aborted) return

        // Cache clearing can reveal a short loading page before its data arrives.
        // Observe layout growth instead of consuming an offset the browser would clamp.
        if (typeof ResizeObserver !== 'undefined') {
            observer = new ResizeObserver(retry)
            observer.observe(document.documentElement)
            observer.observe(document.body)
        }
        timer = setTimeout(() => restore(true), LIVE_SCROLL_RESTORE_TIMEOUT_MS)
        unsubscribe = router.subscribe('onBeforeNavigate', ({ toLocation }) => {
            if (
                toLocation.href !== position.href ||
                toLocation.state['__TSR_key'] !== position.historyKey
            )
                cancel()
        })
        window.addEventListener('resize', retry)
        for (const event of intentEvents)
            window.addEventListener(event, cancel, { capture: true, passive: true })
        return cleanup
    }, [pending, suspended, identityGeneration, verificationGeneration, router])

    return capture
}
