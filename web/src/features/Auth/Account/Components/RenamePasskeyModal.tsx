import { Modal } from '../../../../shared/Modal'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
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
    return (
        <Modal
            open={open}
            onOpenChange={(next) => {
                if (!next && !isPending) onClose()
            }}
            title={mode === 'add' ? 'Name this passkey' : 'Rename passkey'}
            description={
                mode === 'add'
                    ? 'Choose a recognizable name before your authenticator creates the passkey.'
                    : 'Choose a name that helps you recognize this authenticator.'
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
                        Cancel
                    </button>
                    <button
                        type="button"
                        className={uiClassNames.button.primary}
                        disabled={isPending || !logic.state.canSubmit}
                        onClick={logic.handler.confirm}
                    >
                        {isPending ? 'Saving…' : mode === 'add' ? 'Continue' : 'Save name'}
                    </button>
                </>
            }
        >
            <label className={uiClassNames.form.field} htmlFor="passkey-name">
                <span className={uiClassNames.form.label}>Passkey name</span>
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
                    {errorMessage}
                </p>
            ) : null}
        </Modal>
    )
}
