import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'

import type { ApplicationTopbarProps } from '../Types/application-shell.types'

export default function ApplicationTopbar({
    isNavigationExpanded,
    navigationToggleLabel,
    onToggleNavigation,
    themeControl,
}: ApplicationTopbarProps) {
    return (
        <header className="flex min-h-14 items-center justify-between gap-4 border-b border-border bg-topbar px-5 py-[0.8rem] shell:sticky shell:top-0 shell:z-20 shell:px-8 shell:backdrop-blur-[16px]">
            <button
                type="button"
                className="group grid size-[2.05rem] place-items-center rounded-lg border border-border-strong bg-surface-raised text-muted shadow-[inset_0_1px_2px_rgb(2_10_11_/_10%)] transition-[border-color,background-color,color] duration-[180ms] hover:border-brand-500 hover:text-brand-text focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-brand-500 motion-reduce:transition-none"
                aria-controls="application-navigation"
                aria-expanded={isNavigationExpanded}
                aria-label={navigationToggleLabel}
                title={navigationToggleLabel}
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
            <div className="flex items-center">{themeControl}</div>
        </header>
    )
}
