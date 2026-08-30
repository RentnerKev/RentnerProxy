import { useState } from 'react'

import useTranslationStore from '../../../language/useTranslationStore'
import type { ToastMessage } from '../Types/toast.types'
import useCopyToastMessage from './useCopyToastMessage'
import useToast from './useToast'

export default function useToastCardLogic(toast: ToastMessage) {
    const { t } = useTranslationStore()
    const notifications = useToast()
    const [paused, setPaused] = useState(false)
    const title = t(toast.title, { defaultValue: toast.title })
    const message = t(toast.message, { defaultValue: toast.message })
    const clipboard = useCopyToastMessage(`${title}\n${message}`)
    const copyLabel = t(
        clipboard.status === 'copied'
            ? 'toast.copied'
            : clipboard.status === 'failed'
              ? 'toast.copyFailed'
              : 'toast.copyError',
    )

    return {
        state: { title, message, paused, copyLabel, copyStatus: clipboard.status },
        handler: {
            copy: clipboard.copy,
            handleOpenChange: (open: boolean) => {
                if (!open) notifications.dismiss(toast.id)
            },
            pause: () => setPaused(true),
            resume: () => setPaused(false),
        },
    }
}
