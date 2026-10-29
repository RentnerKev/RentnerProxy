import { X } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'
import { ToastFocusScopeBranch } from '@rentnerkev/toasts'
import { SelectProvider } from '@rentnerkev/select'
import { CalendarProvider } from '@rentnerkev/calendar'

import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'

import useModalLogic from './Hooks/useModalLogic.ts'
import type { ModalProps, ModalSize } from './Types/modal.types.ts'

const contentSizeClassNames: Record<ModalSize, string> = {
    sm: 'max-w-md',
    md: 'max-w-xl',
    lg: 'max-w-3xl',
    xl: 'max-w-6xl',
}

export function Modal({
    open,
    onOpenChange,
    title,
    description,
    children,
    footer,
    fixedHeight = false,
    navigation,
    onOpenAutoFocus,
    onClosed,
    size = 'md',
    closeDisabled = false,
}: ModalProps) {
    const { t } = useTranslationStore()
    const {
        state,
        setter: { setSelectPortalContainer },
        handler,
    } = useModalLogic({
        closeDisabled,
        onOpenAutoFocus,
        onOpenChange,
        onClosed,
    })

    return (
        <Dialog.Root open={open} onOpenChange={handler.handleOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-navy-950/70 backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:animate-in data-[state=open]:fade-in motion-reduce:animate-none" />
                {/* Transform-free centering preserves viewport coordinates for portaled controls. */}
                <Dialog.Content
                    onOpenAutoFocus={handler.handleOpenAutoFocus}
                    onCloseAutoFocus={handler.handleCloseAutoFocus}
                    onEscapeKeyDown={handler.handleEscapeKeyDown}
                    onInteractOutside={handler.preventClose}
                    className={`fixed inset-0 z-50 m-auto flex max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] flex-col rounded-2xl border border-border bg-surface shadow-panel outline-hidden sm:max-h-[min(44rem,calc(100dvh-3rem))] sm:w-[calc(100%-3rem)] ${contentSizeClassNames[size]} ${fixedHeight ? 'h-[min(44rem,calc(100dvh-1rem))] sm:h-[min(44rem,calc(100dvh-3rem))]' : 'h-fit'} data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95 motion-reduce:animate-none`}
                >
                    <SelectProvider portalContainer={state.selectPortalContainer}>
                        <CalendarProvider portalContainer={state.selectPortalContainer}>
                            <ToastFocusScopeBranch />
                            <header className="flex shrink-0 items-center justify-between gap-5 border-b border-border px-5 py-4 sm:px-6">
                                <div className="min-w-0">
                                    <Dialog.Title className="m-0 text-lg font-extrabold leading-tight text-ink-soft sm:text-xl">
                                        {title}
                                    </Dialog.Title>
                                    <Dialog.Description className="mt-1.5 max-w-prose text-sm leading-relaxed text-muted">
                                        {description}
                                    </Dialog.Description>
                                </div>
                                <Dialog.Close
                                    type="button"
                                    disabled={closeDisabled}
                                    aria-label={t('common.closeDialog')}
                                    className="inline-flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-transparent text-xl leading-none text-muted transition-colors hover:border-border-strong hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
                                >
                                    <X aria-hidden="true" className="size-5" strokeWidth={1.8} />
                                </Dialog.Close>
                            </header>
                            {navigation ? (
                                <div className="shrink-0 border-b border-border bg-surface-subtle px-5 py-2 sm:px-6">
                                    {navigation}
                                </div>
                            ) : null}
                            {children != null ? (
                                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 text-ink sm:px-6">
                                    {children}
                                </div>
                            ) : null}
                            {footer ? (
                                <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 [&_button]:max-sm:flex-1 rounded-b-2xl border-t border-border bg-surface-subtle px-5 py-4 sm:px-6">
                                    {footer}
                                </footer>
                            ) : null}
                            <div ref={setSelectPortalContainer} data-modal-select-host="" />
                        </CalendarProvider>
                    </SelectProvider>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    )
}
