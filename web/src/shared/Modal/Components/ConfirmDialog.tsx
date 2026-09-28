import * as Dialog from 'radix-ui/dialog'

import useTranslationStore from '../../../language/useTranslationStore'

import { Modal } from '../index'
import useConfirmDialogLogic from '../Hooks/useConfirmDialogLogic'
import type { ConfirmDialogProps } from '../Types/modal.types'

export function ConfirmDialog({
    open,
    onOpenChange,
    title,
    description,
    confirmLabel,
    cancelLabel,
    pendingLabel,
    destructive = false,
    isPending = false,
    onConfirm,
}: ConfirmDialogProps) {
    const { t } = useTranslationStore()
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
                        className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none border-border-strong bg-surface-raised text-ink-soft enabled:hover:border-brand-600 enabled:hover:text-brand-text"
                    >
                        {cancelLabel ?? t('common.cancel')}
                    </Dialog.Close>
                    <button
                        type="button"
                        disabled={isPending}
                        onClick={handleConfirm}
                        className={
                            destructive
                                ? 'box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none border-red-700/25 bg-danger-bg text-danger-text enabled:hover:border-red-500/45 enabled:hover:bg-red-700/20'
                                : 'box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none bg-brand-500 text-navy-950 enabled:hover:bg-brand-300'
                        }
                    >
                        {isPending
                            ? (pendingLabel ?? t('common.working'))
                            : (confirmLabel ?? t('common.confirm'))}
                    </button>
                </>
            }
        />
    )
}
