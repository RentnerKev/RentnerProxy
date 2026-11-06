import { useEffect } from 'react'
import type {
    GlobalErrorPageLogicResult,
    UseGlobalErrorPageLogicParams,
} from '../Types/system-state-page.types.ts'
import { useRouter } from '@tanstack/react-router'

import { getPageErrorDetails } from '@/lib/Errors/pageError.ts'

const recoveryAttempts = new WeakMap<object, { attempts: number; lastAttempt: number }>()
const assetRecoveryKey = 'rentnerproxy.asset-recovery-at'
const assetRecoveryCooldown = 300_000

export default function useGlobalErrorPageLogic({
    error,
    reset,
}: UseGlobalErrorPageLogicParams): GlobalErrorPageLogicResult {
    const router = useRouter()
    const details = getPageErrorDetails(error)
    const automaticRecovery = details.status === 429 || details.status >= 500

    useEffect(() => {
        if (!automaticRecovery) return
        const lifecycle = new AbortController()
        const recovery: { pending: boolean; timer?: ReturnType<typeof setTimeout> } = {
            pending: false,
        }
        const attempts = recoveryAttempts.get(router) ?? { attempts: 0, lastAttempt: Date.now() }
        recoveryAttempts.set(router, attempts)

        const schedule = () => {
            clearTimeout(recovery.timer)
            const delay = Math.min(1000 * 2 ** Math.min(attempts.attempts, 5), 30_000)
            recovery.timer = setTimeout(
                recover,
                Math.max(0, attempts.lastAttempt + delay - Date.now()),
            )
        }
        const recover = () => {
            if (lifecycle.signal.aborted || recovery.pending) return
            clearTimeout(recovery.timer)
            if (navigator.onLine === false || document.visibilityState === 'hidden') return
            if (details.reload) {
                // Persist only a timestamp so a still-broken asset cannot cause a reload loop.
                try {
                    const stored = sessionStorage.getItem(assetRecoveryKey)
                    const previous = Number(stored)
                    const remaining =
                        stored !== null && Number.isFinite(previous)
                            ? Math.min(
                                  assetRecoveryCooldown,
                                  previous + assetRecoveryCooldown - Date.now(),
                              )
                            : 0
                    if (remaining > 0) {
                        recovery.timer = setTimeout(recover, remaining)
                        return
                    }
                    sessionStorage.setItem(assetRecoveryKey, String(Date.now()))
                } catch {
                    // Without durable cooldown storage, automatic reload cannot be guarded.
                    return
                }
                recovery.pending = true
                window.location.reload()
                return
            }
            recovery.pending = true
            attempts.attempts += 1
            attempts.lastAttempt = Date.now()
            reset()
            void router
                .invalidate()
                .catch(() => {})
                .finally(() => {
                    recovery.pending = false
                    if (!lifecycle.signal.aborted) schedule()
                })
        }
        const resume = () => {
            if (
                lifecycle.signal.aborted ||
                navigator.onLine === false ||
                document.visibilityState === 'hidden'
            )
                return
            schedule()
        }
        schedule()
        window.addEventListener('focus', resume)
        window.addEventListener('online', resume)
        document.addEventListener('visibilitychange', resume)
        return () => {
            lifecycle.abort()
            clearTimeout(recovery.timer)
            window.removeEventListener('focus', resume)
            window.removeEventListener('online', resume)
            document.removeEventListener('visibilitychange', resume)
        }
    }, [automaticRecovery, details.reload, router, reset])

    return { state: { details, automaticRecovery } }
}
