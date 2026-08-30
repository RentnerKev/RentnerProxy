import * as ToastPrimitive from 'radix-ui/toast'

import useTranslationStore from '../../../language/useTranslationStore'
import useToastViewportLogic from '../Hooks/useToastViewportLogic'
import { toastClassNames } from '../Styles/toastClassNames'
import ToastCard from './ToastCard'

export default function ToastViewport() {
    const { t } = useTranslationStore()
    const toasts = useToastViewportLogic()

    return (
        <>
            {toasts.map((toast) => (
                <ToastCard key={toast.id} toast={toast} />
            ))}
            <ToastPrimitive.Viewport
                label={t('toast.viewport')}
                className={toastClassNames.viewport}
                data-toast-viewport=""
            />
        </>
    )
}
