import type { ActionMenuLogicResult } from '../Types/action-menu.types.ts'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'

const HOVER_CLOSE_DELAY_MS = 150

export default function useActionMenuLogic(openOnHover: boolean): ActionMenuLogicResult {
    const [open, setOpen] = useState(false)
    const triggerRef = useRef<HTMLButtonElement>(null)
    const contentRef = useRef<HTMLDivElement>(null)
    const closeTimeoutRef = useRef<number | null>(null)
    const hoverSessionRef = useRef(false)
    const closingViaHoverRef = useRef(false)

    const clearCloseTimeout = useCallback(() => {
        if (closeTimeoutRef.current !== null) {
            window.clearTimeout(closeTimeoutRef.current)
            closeTimeoutRef.current = null
        }
    }, [])

    const handlePointerEnter = useCallback(
        (event: PointerEvent<HTMLElement>) => {
            if (event.pointerType !== 'mouse') return
            clearCloseTimeout()
            if (open) return
            hoverSessionRef.current = true
            closingViaHoverRef.current = false
            setOpen(true)
        },
        [clearCloseTimeout, open],
    )

    const handlePointerLeave = useCallback(
        (event: PointerEvent<HTMLElement>) => {
            if (event.pointerType !== 'mouse' || !hoverSessionRef.current) return
            clearCloseTimeout()
            closeTimeoutRef.current = window.setTimeout(() => {
                closeTimeoutRef.current = null
                closingViaHoverRef.current = true
                setOpen(false)
            }, HOVER_CLOSE_DELAY_MS)
        },
        [clearCloseTimeout],
    )

    const handleOpenChange = useCallback(
        (nextOpen: boolean) => {
            clearCloseTimeout()
            hoverSessionRef.current = false
            closingViaHoverRef.current = false
            setOpen(nextOpen)
        },
        [clearCloseTimeout],
    )

    const handleKeyDown = useCallback(
        (event: KeyboardEvent<HTMLElement>) => {
            clearCloseTimeout()
            hoverSessionRef.current = false
            if (
                open &&
                event.currentTarget === triggerRef.current &&
                (event.key === 'ArrowDown' || event.key === 'ArrowUp')
            ) {
                contentRef.current?.focus()
            }
        },
        [clearCloseTimeout, open],
    )

    const handleOpenAutoFocus = useCallback((event: Event) => {
        if (hoverSessionRef.current) event.preventDefault()
    }, [])

    const handleCloseAutoFocus = useCallback((event: Event) => {
        if (closingViaHoverRef.current) event.preventDefault()
        closingViaHoverRef.current = false
    }, [])

    useEffect(() => clearCloseTimeout, [clearCloseTimeout])

    return {
        state: { openOnHover, open },
        refs: { trigger: triggerRef, content: contentRef },
        handler: {
            handlePointerEnter,
            handlePointerLeave,
            handleKeyDown,
            handleOpenChange,
            handleOpenAutoFocus,
            handleCloseAutoFocus,
        },
    }
}
