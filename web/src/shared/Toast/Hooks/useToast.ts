import { createContext, useContext } from 'react'

import type { createToastStore } from '../Helpers/createToastStore'

export const ToastContext = createContext<ReturnType<typeof createToastStore> | null>(null)

export function useToastStore() {
    const store = useContext(ToastContext)
    if (!store) throw new Error('ToastProvider is required for action notifications.')
    return store
}

export default function useToast() {
    return useToastStore().notify
}
