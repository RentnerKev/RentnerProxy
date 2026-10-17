import { Outlet } from '@tanstack/react-router'
import { ToastProvider, toast } from '@rentnerkev/toasts'
import { useEffect } from 'react'

import { TOAST_PROVIDER_PROPS } from '@/config/toast.config.ts'

export default function PublicLayout() {
    useEffect(() => () => toast.dismissAll(), [])

    return (
        <>
            <Outlet />
            <ToastProvider {...TOAST_PROVIDER_PROPS} locale="en">
                {null}
            </ToastProvider>
        </>
    )
}
