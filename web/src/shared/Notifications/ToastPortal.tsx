import { ToastProvider } from '@rentnerkev/toasts'
import { createPortal } from 'react-dom'

import { TOAST_PROVIDER_PROPS } from '@/config/toast.config.ts'
import useToastPortalTarget from './Hooks/useToastPortalTarget.ts'
import type { ToastPortalProps } from './Types/toast-portal.types.ts'

export default function ToastPortal(props: ToastPortalProps) {
    const target = useToastPortalTarget()
    return target
        ? createPortal(
              <ToastProvider {...TOAST_PROVIDER_PROPS} {...props}>
                  {null}
              </ToastProvider>,
              target,
          )
        : null
}
