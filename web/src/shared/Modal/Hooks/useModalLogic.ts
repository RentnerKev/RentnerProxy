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
                // Radix captures Escape before portaled controls can dismiss themselves.
                if (event.target instanceof Node && selectPortalContainer?.contains(event.target)) {
                    const popup =
                        event.target instanceof Element
                            ? event.target.closest<HTMLElement>('[role="dialog"]')
                            : null
                    if (popup?.id && selectPortalContainer.contains(popup)) {
                        // The calendar ignores default-prevented Escape events. Its own trigger
                        // closes it and restores focus without dismissing the parent dialog.
                        const dialog = selectPortalContainer.closest('[role="dialog"]')
                        const trigger = [
                            ...(dialog?.querySelectorAll<HTMLButtonElement>(
                                'button[aria-haspopup="dialog"]',
                            ) ?? []),
                        ].find((button) => button.getAttribute('aria-controls') === popup.id)
                        trigger?.click()
                    }
                    event.preventDefault()
                }
                preventClose(event)
            },
            preventClose,
        },
    }
}
