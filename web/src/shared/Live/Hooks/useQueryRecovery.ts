import { useEffect, useRef } from 'react'
import { LIVE_READ_RETRY_INITIAL_MS, LIVE_READ_RETRY_MAX_MS } from '@/config/realtime.config.ts'
import type { QueryRecoveryState } from '../Types/query-recovery.types.ts'

export default function useQueryRecovery(
    { isError, isSuccess, errorUpdatedAt, refetch }: QueryRecoveryState,
    enabled: boolean,
) {
    const delay = useRef(LIVE_READ_RETRY_INITIAL_MS)
    useEffect(() => {
        if (isSuccess) delay.current = LIVE_READ_RETRY_INITIAL_MS
        if (!enabled || !isError || !errorUpdatedAt) return
        const timeout = window.setTimeout(
            () => void refetch({ cancelRefetch: false }),
            delay.current,
        )
        delay.current = Math.min(delay.current * 2, LIVE_READ_RETRY_MAX_MS)
        return () => window.clearTimeout(timeout)
    }, [enabled, isError, isSuccess, errorUpdatedAt, refetch])
}
