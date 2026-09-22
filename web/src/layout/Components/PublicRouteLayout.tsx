import { ToastProvider } from '@rentnerkev/toasts'
import { Outlet } from '@tanstack/react-router'
import { createPortal } from 'react-dom'

import { TOAST_PROVIDER_PROPS } from '../../config/toast.config'
import useClearNotificationsOnLayoutExit from '../Hooks/useClearNotificationsOnLayoutExit'

export default function PublicRouteLayout() {
    useClearNotificationsOnLayoutExit()

    return (
        <>
            <Outlet />
            {typeof document === 'undefined'
                ? null
                : createPortal(
                      <ToastProvider {...TOAST_PROVIDER_PROPS} locale="en">
                          {null}
                      </ToastProvider>,
                      document.body,
                  )}
        </>
    )
}
