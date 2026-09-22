import type {
    TooltipCustomDesign,
    TooltipProps,
    TooltipProviderProps,
} from '@rentnerkev/tooltips/types'

export const TOOLTIP_CUSTOM_DESIGN = {
    baseClasses:
        'max-w-72 select-none rounded-lg border border-border bg-surface-raised px-3 py-2 text-center text-xs font-semibold leading-snug text-ink shadow-surface outline-hidden',
    animationClasses:
        'motion-safe:animate-[tooltip-enter_85ms_cubic-bezier(0.16,1,0.3,1)] motion-reduce:animate-none',
    contentClasses: 'rentnerproxy-tooltip origin-[var(--radix-tooltip-content-transform-origin)]',
    arrowClasses: 'fill-surface-raised stroke-border',
} satisfies TooltipCustomDesign

export const TOOLTIP_PROVIDER_PROPS = {
    delayDuration: 80,
    skipDelayDuration: 50,
} satisfies Pick<TooltipProviderProps, 'delayDuration' | 'skipDelayDuration'>

export const TOOLTIP_DEFAULT_PROPS = {
    collisionPadding: 10,
    customDesign: TOOLTIP_CUSTOM_DESIGN,
} satisfies Pick<TooltipProps, 'collisionPadding' | 'customDesign'>
