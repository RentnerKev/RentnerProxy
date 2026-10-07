import type { ToastProviderProps } from '@rentnerkev/toasts/types'

export type ToastPortalProps = Pick<
    ToastProviderProps,
    'locale' | 'messages' | 'store' | 'defaultDuration' | 'maxVisibleToasts'
>
