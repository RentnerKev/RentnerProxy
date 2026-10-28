import type { ModalLogicResult, UseModalLogicParams } from '../Types/modal.types.ts'
import { useRef, useState } from 'react'

import { TOAST_ROOT_CLASS } from '@/config/toast.config.ts'
import type { PreventableEvent } from '../Types/modal.types.ts'

export default function useModalLogic({
    closeDisabled,
    onOpenAutoFocus,
    onClosed,
    onOpenChange,
}: UseModalLogicParams): ModalLogicResult {
    const returnFocusRef = useRef<HTMLElement | null>(null)
    const [selectPortalContainer, setSelectPortalContainer] = useState<HTMLDivElement | null>(null)

    const restoreFocus = () => {
        const returnFocusElement = returnFocusRef.current

        if (returnFocusElement?.isConnected) {
            returnFocusElement.focus()
        }

        returnFocusRef.current = null
    }

    const preventClose = (event: PreventableEvent) => {
        const target = event.target
        const isToastInteraction =
            target instanceof Element && target.closest(`.${TOAST_ROOT_CLASS}`) !== null

        if (closeDisabled || isToastInteraction) {
            event.preventDefault()
        }
    }

    return {
        state: { selectPortalContainer },
        setter: { setSelectPortalContainer },
        handler: {
            handleCloseAutoFocus: (event: PreventableEvent) => {
                if (returnFocusRef.current?.isConnected) {
                    event.preventDefault()
                    restoreFocus()
                }
                onClosed?.()
            },
            handleOpenAutoFocus: (event: PreventableEvent) => {
                const activeElement = document.activeElement

                returnFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null
                onOpenAutoFocus?.(event)
            },
            handleOpenChange: (nextOpen: boolean) => {
                if (!nextOpen && closeDisabled) {
                    return
                }

                onOpenChange(nextOpen)
            },
            handleEscapeKeyDown: (event: PreventableEvent) => {
                // Radix handles Escape before the select can close its own popup.
                if (event.target instanceof Node && selectPortalContainer?.contains(event.target)) {
                    event.preventDefault()
                }
                preventClose(event)
            },
            preventClose,
        },
    }
}
