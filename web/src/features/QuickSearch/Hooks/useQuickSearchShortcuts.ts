import { useEffect, useEffectEvent, useSyncExternalStore } from 'react'
import type {
    QuickSearchShortcutsOptions,
    QuickSearchShortcutsResult,
} from '../Types/quick-search.types.ts'

const unsubscribePlatform = () => undefined
const subscribePlatform = () => unsubscribePlatform
const getServerPlatform = () => false
const isApplePlatform = () =>
    /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent)

function hasOpenDialog() {
    return [
        ...document.querySelectorAll('dialog[open], [role="dialog"], [role="alertdialog"]'),
    ].some(
        (dialog) =>
            dialog.getAttribute('data-state') !== 'closed' &&
            !dialog.closest('[hidden], [inert], [aria-hidden="true"]') &&
            (dialog.tagName !== 'DIALOG' || dialog.hasAttribute('open')),
    )
}

function isEditingTarget(target: EventTarget | undefined) {
    if (!(target instanceof Element)) return false
    const editable = target.closest('[contenteditable]')
    return (
        target.closest('input, textarea, select, [role="textbox"]') !== null ||
        (editable !== null && editable.getAttribute('contenteditable') !== 'false')
    )
}

export default function useQuickSearchShortcuts({
    open,
    onOpen,
    onMove,
    onSelect,
}: QuickSearchShortcutsOptions): QuickSearchShortcutsResult {
    const isApple = useSyncExternalStore(subscribePlatform, isApplePlatform, getServerPlatform)
    const openSearch = () => {
        if (!open && !hasOpenDialog()) onOpen()
    }
    const handleGlobalKeyDown = useEffectEvent((event: KeyboardEvent) => {
        if (
            open ||
            event.defaultPrevented ||
            event.repeat ||
            event.isComposing ||
            event.keyCode === 229 ||
            event.altKey ||
            event.shiftKey ||
            event.key.toLowerCase() !== 'k' ||
            !(isApple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) ||
            isEditingTarget(event.composedPath()[0]) ||
            hasOpenDialog()
        )
            return
        event.preventDefault()
        event.stopPropagation()
        onOpen()
    })

    useEffect(() => {
        document.addEventListener('keydown', handleGlobalKeyDown)
        return () => document.removeEventListener('keydown', handleGlobalKeyDown)
    }, [])

    return {
        state: { shortcut: isApple ? '⌘ K' : 'Ctrl+K' },
        handler: {
            open: openSearch,
            inputKeyDown: (event) => {
                if (
                    !open ||
                    event.defaultPrevented ||
                    event.nativeEvent.isComposing ||
                    // Safari may end composition before dispatching its confirming Enter.
                    event.nativeEvent.keyCode === 229 ||
                    event.altKey ||
                    event.ctrlKey ||
                    event.metaKey ||
                    event.shiftKey
                )
                    return
                if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return
                event.preventDefault()
                event.stopPropagation()
                if (event.key === 'ArrowDown') onMove(1)
                else if (event.key === 'ArrowUp') onMove(-1)
                else if (!event.repeat) onSelect()
            },
        },
    }
}
