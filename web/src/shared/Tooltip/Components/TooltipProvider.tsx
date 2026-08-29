import * as TooltipPrimitive from 'radix-ui/tooltip'

import type { TooltipProviderProps } from '../Types/tooltip.types'

export default function TooltipProvider({ children }: TooltipProviderProps) {
    return (
        <TooltipPrimitive.Provider delayDuration={350} skipDelayDuration={120}>
            {children}
        </TooltipPrimitive.Provider>
    )
}
