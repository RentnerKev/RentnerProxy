import { useRef } from 'react'

import { TOAST_ROOT_CLASS } from '../../../config/toast.config'
import type { PreventableEvent } from '../Types/modal.types'

interface UseModalLogicParams {
    readonly closeDisabled: boolean
    readonly onOpenChange: (open: boolean) => void
}

export default function useModalLogic({ closeDisabled, onOpenChange }: UseModalLogicParams) {
    const returnFocusRef = useRef<HTMLElement | null>(null)

    const restoreFocus = () => {
        const returnFocusElement = returnFocusRef.current

        if (returnFocusElement?.isConnected) {
            returnFocusElement.focus()
        }

        returnFocusRef.current = null
    }

    return {
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
    }
}
