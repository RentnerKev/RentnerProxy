import * as ToastPrimitive from 'radix-ui/toast'
import type { ReactNode } from 'react'

import useTranslationStore from '../../../language/useTranslationStore'
import { ToastContext } from '../Hooks/useToast'
import useToastProviderLogic from '../Hooks/useToastProviderLogic'
import ToastViewport from './ToastViewport'

export default function ToastProvider({ children }: { readonly children: ReactNode }) {
    const { t } = useTranslationStore()
    const store = useToastProviderLogic()

    return (
        <ToastContext.Provider value={store}>
            <ToastPrimitive.Provider
                label={t('toast.notification')}
                swipeDirection="right"
                swipeThreshold={60}
            >
                {children}
                <ToastViewport />
            </ToastPrimitive.Provider>
        </ToastContext.Provider>
    )
}
