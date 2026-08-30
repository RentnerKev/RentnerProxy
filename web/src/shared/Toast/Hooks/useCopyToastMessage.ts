import { useCallback, useEffect, useRef, useState } from 'react'

// Adapted from RentnerToasts; copy only the same safe message that is displayed to the user.
export default function useCopyToastMessage(message: string) {
    const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
    const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const mounted = useRef(true)

    useEffect(() => {
        mounted.current = true
        return () => {
            mounted.current = false
            if (resetTimer.current !== null) clearTimeout(resetTimer.current)
        }
    }, [])

    const copy = useCallback(async () => {
        let nextStatus: 'copied' | 'failed' = 'copied'
        try {
            await navigator.clipboard.writeText(message)
        } catch {
            nextStatus = 'failed'
        }
        if (!mounted.current) return
        if (resetTimer.current !== null) clearTimeout(resetTimer.current)
        setStatus(nextStatus)
        resetTimer.current = setTimeout(() => {
            setStatus('idle')
            resetTimer.current = null
        }, 2000)
    }, [message])

    return { status, copy }
}
