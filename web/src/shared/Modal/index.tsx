import { X } from 'lucide-react'
import * as Dialog from 'radix-ui/dialog'

import useTranslationStore from '../../language/useTranslationStore'

import useModalLogic from './Hooks/useModalLogic'
import type { ModalProps, ModalSize } from './Types/modal.types'

const contentSizeClassNames: Record<ModalSize, string> = {
    sm: 'max-w-md',
    md: 'max-w-xl',
    lg: 'max-w-3xl',
}

export function Modal({
    open,
    onOpenChange,
    title,
    description,
    children,
    footer,
    size = 'md',
    closeDisabled = false,
}: ModalProps) {
    const { t } = useTranslationStore()
    const handler = useModalLogic({ closeDisabled, onOpenChange })

    return (
        <Dialog.Root open={open} onOpenChange={handler.handleOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-navy-950/70 backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:animate-in data-[state=open]:fade-in motion-reduce:animate-none" />
                <Dialog.Content
                    onOpenAutoFocus={handler.handleOpenAutoFocus}
                    onCloseAutoFocus={handler.handleCloseAutoFocus}
                    onEscapeKeyDown={handler.preventClose}
                    onInteractOutside={handler.preventClose}
                    className={`fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-panel outline-hidden sm:max-h-[min(44rem,calc(100dvh-3rem))] sm:w-[calc(100%-3rem)] ${contentSizeClassNames[size]} data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95 motion-reduce:animate-none`}
                >
                    <header className="flex shrink-0 items-start justify-between gap-5 border-b border-border px-5 py-4 sm:px-6">
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
                            className="-mr-1 -mt-1 inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-transparent text-xl leading-none text-muted transition-colors hover:border-border-strong hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
                        >
                            <X aria-hidden="true" className="size-5" strokeWidth={1.8} />
                        </Dialog.Close>
                    </header>
                    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 text-ink sm:px-6">
                        {children}
                    </div>
                    {footer ? (
                        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border bg-surface-subtle px-5 py-4 sm:px-6">
                            {footer}
                        </footer>
                    ) : null}
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    )
}

export type { ModalProps, ModalSize } from './Types/modal.types'
