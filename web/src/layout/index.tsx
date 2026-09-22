import { InputProvider } from '@rentnerkev/inputs'
import { TooltipProvider } from '@rentnerkev/tooltips/tooltip'
import { Outlet } from '@tanstack/react-router'

import { INPUT_PROVIDER_PROPS } from '../config/input.config'
import { TOOLTIP_PROVIDER_PROPS } from '../config/tooltip.config'
import QueryProvider from '../integrations/TanstackQuery'

export default function RootLayout() {
    return (
        <TooltipProvider {...TOOLTIP_PROVIDER_PROPS}>
            <InputProvider {...INPUT_PROVIDER_PROPS} locale="en">
                <QueryProvider>
                    <Outlet />
                </QueryProvider>
            </InputProvider>
        </TooltipProvider>
    )
}
