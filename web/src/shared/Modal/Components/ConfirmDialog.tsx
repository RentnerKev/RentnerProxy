import * as Dialog from 'radix-ui/dialog'

import useTranslationStore from '../../../language/useTranslationStore'
import { uiClassNames } from '../../Styles/uiClassNames'

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
                        className={uiClassNames.button.secondary}
                    >
                        {cancelLabel ?? t('common.cancel')}
                    </Dialog.Close>
                    <button
                        type="button"
                        disabled={isPending}
                        onClick={handleConfirm}
                        className={
                            destructive ? uiClassNames.button.danger : uiClassNames.button.primary
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
