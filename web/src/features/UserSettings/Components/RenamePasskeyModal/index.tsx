import type { RenamePasskeyModalProps } from './Types/rename-passkey-modal-props.types.ts'
import { TextInput } from '@rentnerkev/inputs'
import { Modal } from '@/shared/Modal/index.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useRenamePasskeyModalLogic from './Hooks/useRenamePasskeyModalLogic.ts'
import {
    ModalActionButton,
    ModalCancelButton,
    ModalSaveButton,
} from '@/shared/Modal/Components/ModalActions.tsx'

export default function RenamePasskeyModal({
    initialName,
    isPending,
    mode,
    open,
    onConfirm,
    onClose,
}: RenamePasskeyModalProps) {
    const logic = useRenamePasskeyModalLogic(initialName, onConfirm, onClose, isPending)
    const { t } = useTranslationStore()

    return (
        <Modal
            open={open}
            onOpenChange={logic.handler.handleOpenChange}
            title={
                mode === 'add'
                    ? t('account.passkeys.name.addTitle')
                    : t('account.passkeys.name.renameTitle')
            }
            description={
                mode === 'add'
                    ? t('account.passkeys.name.addDescription')
                    : t('account.passkeys.name.renameDescription')
            }
            closeDisabled={isPending}
            footer={
                <>
                    <ModalCancelButton type="button" disabled={isPending} onClick={onClose} />
                    {mode === 'add' ? (
                        <ModalActionButton
                            type="button"
                            disabled={isPending || !logic.state.canSubmit}
                            onClick={logic.handler.confirm}
                        >
                            {t(isPending ? 'common.saving' : 'account.passkeys.name.continue')}
                        </ModalActionButton>
                    ) : (
                        <ModalSaveButton
                            type="button"
                            disabled={!logic.state.canSubmit}
                            onClick={logic.handler.confirm}
                            isPending={isPending}
                        />
                    )}
                </>
            }
        >
            <label className="grid gap-[0.45rem]" htmlFor="passkey-name">
                <span className="text-[0.82rem] font-[750] text-ink-soft">
                    {t('account.passkeys.name.label')}
                </span>
                <TextInput
                    placeholder={t('placeholders.passkeyName')}
                    id="passkey-name"
                    autoComplete="off"
                    maxLength={100}
                    value={logic.state.name}
                    onValueChange={logic.handler.setName}
                />
            </label>
        </Modal>
    )
}
