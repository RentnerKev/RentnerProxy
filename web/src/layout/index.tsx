import { TooltipProvider } from '@rentnerkev/tooltips/tooltip'
import { Outlet } from '@tanstack/react-router'

import { TOOLTIP_PROVIDER_PROPS } from '../config/tooltip.config'
import QueryProvider from '../integrations/TanstackQuery'

export default function RootLayout() {
    return (
        <TooltipProvider {...TOOLTIP_PROVIDER_PROPS}>
            <QueryProvider>
                <Outlet />
            </QueryProvider>
        </TooltipProvider>
    )
}
