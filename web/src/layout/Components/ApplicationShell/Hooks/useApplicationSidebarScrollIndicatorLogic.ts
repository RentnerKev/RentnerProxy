import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, RefObject } from 'react'

interface IndicatorPosition {
    readonly angle: number
    readonly height: number
    readonly left: number
    readonly maxScroll: number
    readonly scrollTop: number
    readonly top: number
}

interface DragStart {
    readonly pointerY: number
    readonly scrollTop: number
}

const EDGE_WIDTH = 80
const EDGE_HEIGHT = 1440
const THUMB_WIDTH = 26

function cubic(start: number, controlOne: number, controlTwo: number, end: number, t: number) {
    const remaining = 1 - t
    return (
        remaining ** 3 * start +
        3 * remaining ** 2 * t * controlOne +
        3 * remaining * t ** 2 * controlTwo +
        t ** 3 * end
    )
}

function curveXAtY(y: number): number {
    let low = 0
    let high = 1

    for (let index = 0; index < 14; index += 1) {
        const middle = (low + high) / 2
        if (cubic(0, 335, 955, EDGE_HEIGHT, middle) < y) low = middle
        else high = middle
    }

    return cubic(57, 125, -8, 53, (low + high) / 2)
}

export default function useApplicationSidebarScrollIndicatorLogic(
    scrollContainerRef: RefObject<HTMLDivElement | null>,
    sidebarRef: RefObject<HTMLElement | null>,
) {
    const [position, setPosition] = useState<IndicatorPosition | null>(null)
    const [isDragging, setIsDragging] = useState(false)
    const dragStart = useRef<DragStart | null>(null)
    const scrollTravel = useRef(0)

    useEffect(() => {
        const scrollContainer = scrollContainerRef.current
        const sidebar = sidebarRef.current
        if (!scrollContainer || !sidebar) return

        const updatePosition = () => {
            const maxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight
            const sidebarBounds = sidebar.getBoundingClientRect()
            const scrollBounds = scrollContainer.getBoundingClientRect()

            if (maxScroll <= 1 || scrollBounds.height < 32 || sidebarBounds.height === 0) {
                setPosition(null)
                return
            }

            const thumbHeight = Math.min(
                scrollBounds.height,
                Math.max(
                    32,
                    Math.min(
                        56,
                        (scrollBounds.height * scrollContainer.clientHeight) /
                            scrollContainer.scrollHeight,
                    ),
                ),
            )
            const travel = scrollBounds.height - thumbHeight
            const scrollTop = Math.min(maxScroll, Math.max(0, scrollContainer.scrollTop))
            const top = scrollBounds.top - sidebarBounds.top + (scrollTop / maxScroll) * travel
            const curveY = ((top + thumbHeight / 2) / sidebarBounds.height) * EDGE_HEIGHT
            const lineX =
                sidebarBounds.width - EDGE_WIDTH + 5 + (curveXAtY(curveY) / 120) * EDGE_WIDTH
            const slope =
                ((curveXAtY(Math.min(EDGE_HEIGHT, curveY + 12)) -
                    curveXAtY(Math.max(0, curveY - 12))) *
                    EDGE_WIDTH) /
                120
            const verticalDistance = (24 * sidebarBounds.height) / EDGE_HEIGHT

            scrollTravel.current = travel
            setPosition({
                angle: (-Math.atan2(slope, verticalDistance) * 180) / Math.PI,
                height: thumbHeight,
                left: lineX - THUMB_WIDTH / 2,
                maxScroll,
                scrollTop,
                top,
            })
        }

        scrollContainer.addEventListener('scroll', updatePosition, { passive: true })
        window.addEventListener('resize', updatePosition)

        const resizeObserver =
            typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePosition)
        resizeObserver?.observe(sidebar)
        resizeObserver?.observe(scrollContainer)
        if (scrollContainer.firstElementChild) {
            resizeObserver?.observe(scrollContainer.firstElementChild)
        }

        updatePosition()

        return () => {
            scrollContainer.removeEventListener('scroll', updatePosition)
            window.removeEventListener('resize', updatePosition)
            resizeObserver?.disconnect()
        }
    }, [scrollContainerRef, sidebarRef])

    const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
        const scrollContainer = scrollContainerRef.current
        if (event.button !== 0 || !scrollContainer) return

        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        dragStart.current = { pointerY: event.clientY, scrollTop: scrollContainer.scrollTop }
        setIsDragging(true)
    }

    const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
        const scrollContainer = scrollContainerRef.current
        const start = dragStart.current
        if (!scrollContainer || !start || scrollTravel.current <= 0) return

        const maxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight
        scrollContainer.scrollTop =
            start.scrollTop + ((event.clientY - start.pointerY) / scrollTravel.current) * maxScroll
    }

    const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
        dragStart.current = null
        setIsDragging(false)
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
        }
    }

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const scrollContainer = scrollContainerRef.current
        if (!scrollContainer) return

        switch (event.key) {
            case 'ArrowDown':
                scrollContainer.scrollTop += 48
                break
            case 'ArrowUp':
                scrollContainer.scrollTop -= 48
                break
            case 'PageDown':
                scrollContainer.scrollTop += scrollContainer.clientHeight * 0.8
                break
            case 'PageUp':
                scrollContainer.scrollTop -= scrollContainer.clientHeight * 0.8
                break
            case 'Home':
                scrollContainer.scrollTop = 0
                break
            case 'End':
                scrollContainer.scrollTop = scrollContainer.scrollHeight
                break
            default:
                return
        }

        event.preventDefault()
    }

    return {
        position,
        isDragging,
        handlePointerDown,
        handlePointerMove,
        handlePointerEnd,
        handleKeyDown,
    }
}
