import { Outlet } from '@tanstack/react-router'

import ToastPortal from '@/shared/Notifications/ToastPortal.tsx'
import useClearNotificationsOnLayoutExit from '@/layouts/RootLayout/Hooks/useClearNotificationsOnLayoutExit.ts'

export default function PublicLayout() {
    useClearNotificationsOnLayoutExit()

    return (
        <>
            <Outlet />
            <ToastPortal locale="en" />
        </>
    )
}
