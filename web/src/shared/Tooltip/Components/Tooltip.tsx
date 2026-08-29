import * as TooltipPrimitive from 'radix-ui/tooltip'

import type { TooltipProps } from '../Types/tooltip.types'

export default function Tooltip({ children, content, side = 'top' }: TooltipProps) {
    return (
        <TooltipPrimitive.Root>
            <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
            <TooltipPrimitive.Portal>
                <TooltipPrimitive.Content
                    side={side}
                    sideOffset={8}
                    collisionPadding={10}
                    className="z-[90] max-w-64 select-none rounded-lg border border-brand-500/30 bg-navy-950 px-3 py-2 text-center text-[0.72rem] font-bold leading-relaxed text-white shadow-[0_12px_30px_rgb(1_16_22_/_28%)] outline-hidden data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95 data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in data-[state=delayed-open]:zoom-in-95 data-[state=instant-open]:animate-in data-[state=instant-open]:fade-in data-[state=instant-open]:zoom-in-95 motion-reduce:animate-none"
                >
                    {content}
                    <TooltipPrimitive.Arrow
                        width={10}
                        height={5}
                        className="fill-navy-950 stroke-brand-500/30"
                    />
                </TooltipPrimitive.Content>
            </TooltipPrimitive.Portal>
        </TooltipPrimitive.Root>
    )
}
