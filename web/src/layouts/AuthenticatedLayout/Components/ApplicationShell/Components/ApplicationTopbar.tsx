import { CustomTooltip } from '@rentnerkev/tooltips/tooltip'
import { EllipsisVertical, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'

import { TOOLTIP_DEFAULT_PROPS } from '@/config/tooltip.config.ts'
import type { ApplicationTopbarProps } from '../Types/application-shell.types.ts'

export default function ApplicationTopbar({
    isMobileNavigationOpen,
    isNavigationExpanded,
    mobileNavigationToggleLabel,
    navigationToggleLabel,
    onToggleMobileNavigation,
    onToggleNavigation,
    themeControl,
}: ApplicationTopbarProps) {
    return (
        <header
            className={`relative flex min-h-14 items-center justify-between gap-4 overflow-hidden border-b border-border bg-topbar px-5 py-[0.8rem] transition-[margin,padding] duration-180 shell:sticky shell:top-0 shell:z-20 shell:backdrop-blur-[16px] motion-reduce:transition-none ${
                isNavigationExpanded
                    ? 'shell:-ml-12 shell:pr-8 shell:pl-[5.25rem]'
                    : 'shell:ml-0 shell:px-8'
            }`}
        >
            <button
                type="button"
                className="grid size-11 cursor-pointer place-items-center rounded-full border border-brand-500/40 bg-brand-500/10 text-brand-text transition-[background-color,border-color] duration-180 hover:border-brand-500 hover:bg-brand-500/20 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-accent-ring shell:hidden motion-reduce:transition-none"
                aria-controls="application-mobile-navigation"
                aria-expanded={isMobileNavigationOpen}
                aria-label={mobileNavigationToggleLabel}
                onClick={onToggleMobileNavigation}
            >
                {isMobileNavigationOpen ? (
                    <X aria-hidden="true" className="size-5" strokeWidth={1.8} />
                ) : (
                    <EllipsisVertical aria-hidden="true" className="size-5" strokeWidth={2} />
                )}
            </button>
            <CustomTooltip {...TOOLTIP_DEFAULT_PROPS} content={navigationToggleLabel} side="right">
                <button
                    type="button"
                    className="group hidden size-12 cursor-pointer place-items-center rounded-xl border border-border-strong bg-surface-raised text-muted transition-[border-color,background-color,color] duration-180 hover:border-brand-500 hover:bg-surface-hover hover:text-brand-text focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-accent-ring shell:grid motion-reduce:transition-none"
                    aria-controls="application-navigation"
                    aria-expanded={isNavigationExpanded}
                    aria-label={navigationToggleLabel}
                    onClick={onToggleNavigation}
                >
                    <PanelLeftOpen
                        aria-hidden="true"
                        className="size-4 group-aria-expanded:hidden"
                        strokeWidth={1.7}
                    />
                    <PanelLeftClose
                        aria-hidden="true"
                        className="hidden size-4 group-aria-expanded:block"
                        strokeWidth={1.7}
                    />
                </button>
            </CustomTooltip>
            <div className="flex items-center">{themeControl}</div>
        </header>
    )
}
