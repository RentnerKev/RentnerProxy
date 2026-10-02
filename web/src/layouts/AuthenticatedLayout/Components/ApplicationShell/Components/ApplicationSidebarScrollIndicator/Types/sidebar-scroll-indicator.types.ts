import type { KeyboardEvent, PointerEvent, RefObject } from 'react'
export interface IndicatorPosition {
    readonly angle: number
    readonly height: number
    readonly left: number
    readonly maxScroll: number
    readonly scrollTop: number
    readonly top: number
}
export interface ApplicationSidebarScrollIndicatorProps {
    readonly scrollContainerRef: RefObject<HTMLDivElement | null>
    readonly sidebarRef: RefObject<HTMLElement | null>
}
export interface SidebarScrollIndicatorLogicResult {
    readonly state: { readonly position: IndicatorPosition | null; readonly isDragging: boolean }
    readonly handler: {
        readonly handlePointerDown: (event: PointerEvent<HTMLDivElement>) => void
        readonly handlePointerMove: (event: PointerEvent<HTMLDivElement>) => void
        readonly handlePointerEnd: (event: PointerEvent<HTMLDivElement>) => void
        readonly handleKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
    }
}
