import type { ApplicationSidebarScrollIndicatorProps } from './Types/sidebar-scroll-indicator.types.ts'

import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useApplicationSidebarScrollIndicatorLogic from './Hooks/useApplicationSidebarScrollIndicatorLogic.ts'

export default function ApplicationSidebarScrollIndicator({
    scrollContainerRef,
    sidebarRef,
}: ApplicationSidebarScrollIndicatorProps) {
    const { t } = useTranslationStore()
    const { state, handler } = useApplicationSidebarScrollIndicatorLogic(
        scrollContainerRef,
        sidebarRef,
    )
    if (!state.position) return null

    return (
        <div
            role="scrollbar"
            tabIndex={0}
            aria-label={t('shell.navigation')}
            aria-controls="application-navigation-links"
            aria-orientation="vertical"
            aria-valuemin={0}
            aria-valuemax={Math.ceil(state.position.maxScroll)}
            aria-valuenow={Math.round(state.position.scrollTop)}
            className={`group absolute top-0 left-0 z-30 hidden w-[1.625rem] cursor-pointer touch-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300 shell:block motion-reduce:transition-none ${
                state.isDragging
                    ? 'cursor-grabbing transition-none'
                    : 'transition-transform duration-360 ease-[cubic-bezier(0.18,0.7,0.22,1)]'
            }`}
            style={{
                height: state.position.height,
                transform: `translate3d(${state.position.left}px, ${state.position.top}px, 0) rotate(${state.position.angle}deg)`,
            }}
            onPointerDown={handler.handlePointerDown}
            onPointerMove={handler.handlePointerMove}
            onPointerUp={handler.handlePointerEnd}
            onPointerCancel={handler.handlePointerEnd}
            onKeyDown={handler.handleKeyDown}
        >
            <span
                className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-[0.65rem] border border-brand-400/60 bg-[#020a0b] shadow-[0_0_0_1px_#020a0b,0_4px_12px_#0008] transition-transform duration-200 group-hover:scale-110 group-focus-visible:scale-110 motion-reduce:transition-none"
                style={{
                    backgroundImage:
                        'linear-gradient(110deg, rgb(var(--accent-rgb) / 35%), rgb(var(--accent-rgb) / 72%) 52%, rgb(var(--accent-rgb) / 25%))',
                }}
            >
                <span className="h-px w-2.5 bg-brand-300/80" aria-hidden="true" />
                <span className="h-px w-2.5 bg-brand-300/80" aria-hidden="true" />
            </span>
        </div>
    )
}
