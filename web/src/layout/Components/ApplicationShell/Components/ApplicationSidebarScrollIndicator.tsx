import type { RefObject } from 'react'

import useTranslationStore from '../../../../language/useTranslationStore'
import useApplicationSidebarScrollIndicatorLogic from '../Hooks/useApplicationSidebarScrollIndicatorLogic'

interface ApplicationSidebarScrollIndicatorProps {
    readonly scrollContainerRef: RefObject<HTMLDivElement | null>
    readonly sidebarRef: RefObject<HTMLElement | null>
}

export default function ApplicationSidebarScrollIndicator({
    scrollContainerRef,
    sidebarRef,
}: ApplicationSidebarScrollIndicatorProps) {
    const { t } = useTranslationStore()
    const {
        position,
        isDragging,
        handlePointerDown,
        handlePointerMove,
        handlePointerEnd,
        handleKeyDown,
    } = useApplicationSidebarScrollIndicatorLogic(scrollContainerRef, sidebarRef)
    if (!position) return null

    return (
        <div
            role="scrollbar"
            tabIndex={0}
            aria-label={t('shell.navigation')}
            aria-controls="application-navigation-links"
            aria-orientation="vertical"
            aria-valuemin={0}
            aria-valuemax={Math.ceil(position.maxScroll)}
            aria-valuenow={Math.round(position.scrollTop)}
            className={`group absolute top-0 left-0 z-30 hidden w-[1.625rem] cursor-pointer touch-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300 shell:block motion-reduce:transition-none ${
                isDragging
                    ? 'cursor-grabbing transition-none'
                    : 'transition-transform duration-[360ms] ease-[cubic-bezier(0.18,0.7,0.22,1)]'
            }`}
            style={{
                height: position.height,
                transform: `translate3d(${position.left}px, ${position.top}px, 0) rotate(${position.angle}deg)`,
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
            onKeyDown={handleKeyDown}
        >
            <span className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-[0.65rem] border border-brand-400/60 bg-[linear-gradient(110deg,#075522,#0c8130_52%,#06461d)] shadow-[0_0_0_1px_#020a0b,0_4px_12px_#0008] transition-transform duration-200 group-hover:scale-110 group-focus-visible:scale-110 motion-reduce:transition-none">
                <span className="h-px w-2.5 bg-brand-300/80" aria-hidden="true" />
                <span className="h-px w-2.5 bg-brand-300/80" aria-hidden="true" />
            </span>
        </div>
    )
}
