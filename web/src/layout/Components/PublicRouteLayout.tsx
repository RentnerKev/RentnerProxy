import { Outlet } from '@tanstack/react-router'

import ToastProvider from '../../shared/Toast/Components/ToastProvider'

export default function PublicRouteLayout() {
    return (
        <ToastProvider>
            <Outlet />
        </ToastProvider>
    )
}
