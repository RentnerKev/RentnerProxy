import * as Dialog from 'radix-ui/dialog'

import { Modal } from '../index'
import useConfirmDialogLogic from '../Hooks/useConfirmDialogLogic'
import type { ConfirmDialogProps } from '../Types/modal.types'

export function ConfirmDialog({
    open,
    onOpenChange,
    title,
    description,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    pendingLabel = 'Working…',
    destructive = false,
    isPending = false,
    onConfirm,
    errorMessage,
}: ConfirmDialogProps) {
    const { handleConfirm } = useConfirmDialogLogic({ isPending, onConfirm })

    return (
        <Modal
            open={open}
            onOpenChange={onOpenChange}
            title={title}
            description={description}
            size="sm"
            closeDisabled={isPending}
            footer={
                <>
                    <Dialog.Close
                        type="button"
                        disabled={isPending}
                        className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-xl border border-border-strong bg-surface-raised px-4 py-[0.65rem] text-sm font-extrabold text-ink-soft transition-[background-color,border-color,color] duration-150 hover:border-brand-600 hover:text-brand-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-[0.55] motion-reduce:transition-none"
                    >
                        {cancelLabel}
                    </Dialog.Close>
                    <button
                        type="button"
                        disabled={isPending}
                        onClick={handleConfirm}
                        className={`inline-flex min-h-10 cursor-pointer items-center justify-center rounded-xl border border-transparent px-4 py-[0.65rem] text-sm font-extrabold transition-[transform,background-color,color,border-color] duration-150 hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none motion-reduce:transition-none ${destructive ? 'bg-danger-bg text-danger-text hover:border-red-500/45 hover:bg-red-700/20' : 'bg-brand-500 text-navy-950 shadow-[0_10px_24px_rgb(15_179_58_/_20%)] hover:bg-brand-300'}`}
                    >
                        {isPending ? pendingLabel : confirmLabel}
                    </button>
                </>
            }
        >
            {errorMessage ? (
                <p
                    role="alert"
                    className="mb-4 rounded-xl border border-red-700/25 bg-danger-bg px-3.5 py-3 text-sm leading-relaxed text-danger-text"
                >
                    {errorMessage}
                </p>
            ) : null}
        </Modal>
    )
}
