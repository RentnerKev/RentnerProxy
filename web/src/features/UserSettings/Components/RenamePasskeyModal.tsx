import { Modal } from '../../../shared/Modal'
import { uiClassNames } from '../../../shared/Styles/uiClassNames'
import useTranslationStore from '../../../language/useTranslationStore'
import useRenamePasskeyModalLogic from '../Hooks/useRenamePasskeyModalLogic'

interface RenamePasskeyModalProps {
    readonly errorMessage?: string | null
    readonly initialName: string
    readonly isPending: boolean
    readonly mode: 'add' | 'rename'
    readonly open: boolean
    readonly onConfirm: (name: string) => void
    readonly onClose: () => void
}

export default function RenamePasskeyModal({
    errorMessage,
    initialName,
    isPending,
    mode,
    open,
    onConfirm,
    onClose,
}: RenamePasskeyModalProps) {
    const logic = useRenamePasskeyModalLogic(initialName, onConfirm)
    const { t } = useTranslationStore()

    return (
        <Modal
            open={open}
            onOpenChange={(next) => {
                if (!next && !isPending) onClose()
            }}
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
                    <button
                        type="button"
                        className={uiClassNames.button.secondary}
                        disabled={isPending}
                        onClick={onClose}
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        type="button"
                        className={uiClassNames.button.primary}
                        disabled={isPending || !logic.state.canSubmit}
                        onClick={logic.handler.confirm}
                    >
                        {isPending
                            ? t('common.saving')
                            : mode === 'add'
                              ? t('account.passkeys.name.continue')
                              : t('account.passkeys.name.save')}
                    </button>
                </>
            }
        >
            <label className={uiClassNames.form.field} htmlFor="passkey-name">
                <span className={uiClassNames.form.label}>{t('account.passkeys.name.label')}</span>
                <input
                    id="passkey-name"
                    className={uiClassNames.form.control}
                    autoComplete="off"
                    maxLength={100}
                    value={logic.state.name}
                    onChange={(event) => logic.handler.setName(event.target.value)}
                />
            </label>
            {errorMessage ? (
                <p role="alert" className="mt-3 text-sm text-danger-text">
                    {t(errorMessage)}
                </p>
            ) : null}
        </Modal>
    )
}
