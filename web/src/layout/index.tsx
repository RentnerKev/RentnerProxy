import { Outlet } from '@tanstack/react-router'

import QueryProvider from '../integrations/TanstackQuery'
import { TooltipProvider } from '../shared/Tooltip'

export default function RootLayout() {
    return (
        <TooltipProvider>
            <QueryProvider>
                <Outlet />
            </QueryProvider>
        </TooltipProvider>
    )
}
