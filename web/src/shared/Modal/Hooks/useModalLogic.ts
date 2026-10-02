import type { ModalLogicResult, UseModalLogicParams } from '../Types/modal.types.ts'
import { useRef } from 'react'

import { TOAST_ROOT_CLASS } from '@/config/toast.config.ts'
import type { PreventableEvent } from '../Types/modal.types.ts'

export default function useModalLogic({
    closeDisabled,
    onOpenChange,
}: UseModalLogicParams): ModalLogicResult {
    const returnFocusRef = useRef<HTMLElement | null>(null)

    const restoreFocus = () => {
        const returnFocusElement = returnFocusRef.current

        if (returnFocusElement?.isConnected) {
            returnFocusElement.focus()
        }

        returnFocusRef.current = null
    }

    return {
        handler: {
            handleCloseAutoFocus: (event: PreventableEvent) => {
                if (returnFocusRef.current?.isConnected) {
                    event.preventDefault()
                    restoreFocus()
                }
            },
            handleOpenAutoFocus: () => {
                const activeElement = document.activeElement

                returnFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null
            },
            handleOpenChange: (nextOpen: boolean) => {
                if (!nextOpen && closeDisabled) {
                    return
                }

                onOpenChange(nextOpen)

                if (!nextOpen) {
                    window.setTimeout(restoreFocus, 0)
                }
            },
            preventClose: (event: PreventableEvent) => {
                const target = event.target
                const isToastInteraction =
                    target instanceof Element && target.closest(`.${TOAST_ROOT_CLASS}`) !== null

                if (closeDisabled || isToastInteraction) {
                    event.preventDefault()
                }
            },
        },
    }
}
