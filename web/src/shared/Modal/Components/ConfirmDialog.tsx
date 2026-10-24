import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'

import { Modal } from '../index.tsx'
import useConfirmDialogLogic from '../Hooks/useConfirmDialogLogic.ts'
import type { ConfirmDialogProps } from '../Types/modal.types.ts'
import { ModalActionButton, ModalCancelButton } from './ModalActions.tsx'

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
    const { handler } = useConfirmDialogLogic({ isPending, onConfirm })

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
                    <ModalCancelButton disabled={isPending} onClick={() => onOpenChange(false)}>
                        {cancelLabel ?? t('common.cancel')}
                    </ModalCancelButton>
                    <ModalActionButton
                        disabled={isPending}
                        onClick={handler.handleConfirm}
                        variant={destructive ? 'danger' : 'primary'}
                    >
                        {isPending
                            ? (pendingLabel ?? t('common.working'))
                            : (confirmLabel ?? t('common.confirm'))}
                    </ModalActionButton>
                </>
            }
        />
    )
}
