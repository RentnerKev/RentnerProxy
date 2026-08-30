import type { ToastMessage, ToastOptions, ToastTone } from '../Types/toast.types'

// Adapted from RentnerToasts: a bounded stack, owned by a provider rather than an SSR singleton.
export function createToastStore() {
    const emptySnapshot: ReadonlyArray<ToastMessage> = []
    let toasts = emptySnapshot
    let sequence = 0
    const listeners = new Set<() => void>()
    const removalTimers = new Map<string, ReturnType<typeof setTimeout>>()

    function publish(next: ReadonlyArray<ToastMessage>) {
        toasts = next
        listeners.forEach((listener) => listener())
    }

    function cancelRemoval(id: string) {
        const timer = removalTimers.get(id)
        if (timer !== undefined) clearTimeout(timer)
        removalTimers.delete(id)
    }

    function remove(id: string) {
        cancelRemoval(id)
        publish(toasts.filter((toast) => toast.id !== id))
    }

    function dismiss(id: string) {
        if (!toasts.some((toast) => toast.id === id && toast.open)) return
        publish(toasts.map((toast) => (toast.id === id ? { ...toast, open: false } : toast)))
        removalTimers.set(
            id,
            setTimeout(() => remove(id), 220),
        )
    }

    function clear() {
        removalTimers.forEach(clearTimeout)
        removalTimers.clear()
        publish(emptySnapshot)
    }

    function show(message: string, tone: ToastTone = 'success', options: ToastOptions = {}) {
        const title = options.title ?? `toast.titles.${tone}`
        const duration = options.duration ?? (tone === 'error' ? 10000 : 6000)
        const toast: ToastMessage = {
            id: `toast-${++sequence}`,
            message,
            title,
            tone,
            duration: duration > 0 ? duration : 6000,
            open: true,
        }
        const remaining = toasts
            .filter(
                (entry) =>
                    entry.open &&
                    !(entry.message === message && entry.tone === tone && entry.title === title),
            )
            .slice(-2)
        for (const entry of toasts) {
            if (!remaining.includes(entry)) cancelRemoval(entry.id)
        }
        publish([...remaining, toast])
        return toast.id
    }

    return {
        getSnapshot: () => toasts,
        getServerSnapshot: () => emptySnapshot,
        subscribe(listener: () => void) {
            listeners.add(listener)
            return () => {
                listeners.delete(listener)
            }
        },
        notify: {
            show,
            success: (message: string, options?: ToastOptions) => show(message, 'success', options),
            error: (message: string, options?: ToastOptions) => show(message, 'error', options),
            info: (message: string, options?: ToastOptions) => show(message, 'info', options),
            warning: (message: string, options?: ToastOptions) => show(message, 'warning', options),
            dismiss,
            clear,
        },
    }
}
