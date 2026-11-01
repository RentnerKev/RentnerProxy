import { BACKUP_DOWNLOAD_TIMEOUTS } from '../../config/backup-download.config.ts'

export function createBackupDownloadTimeout(
    abort: () => void,
    timings = BACKUP_DOWNLOAD_TIMEOUTS,
    monitorPreparation = true,
    schedule = (callback: () => void, delay: number) => {
        const timer = setTimeout(callback, delay)
        return () => clearTimeout(timer)
    },
) {
    let closed = false
    let cancelIdle: (() => void) | undefined
    const cancelPreparation = schedule(expire, timings.preparationMs)

    function clear() {
        closed = true
        cancelPreparation()
        cancelIdle?.()
    }

    function expire() {
        if (closed) return
        clear()
        abort()
    }

    function progress() {
        if (closed) return
        cancelIdle?.()
        cancelIdle = schedule(expire, timings.idleMs)
    }

    if (monitorPreparation) progress()
    return {
        clear,
        progress,
        streaming() {
            if (closed) return
            cancelPreparation()
            progress()
        },
    }
}
