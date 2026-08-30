import { Modal } from '../../../../shared/Modal'
import PasswordInput from '../../../../shared/Forms/PasswordInput'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'

interface ReauthenticationModalProps {
    readonly open: boolean
    readonly isPending: boolean
    readonly value: string
    readonly errorMessage?: string | null
    readonly onChange: (value: string) => void
    readonly onConfirm: () => void
    readonly onPasskey: () => void
    readonly onClose: () => void
}
export default function ReauthenticationModal({
    open,
    isPending,
    value,
    errorMessage,
    onChange,
    onConfirm,
    onPasskey,
    onClose,
}: ReauthenticationModalProps) {
    return (
        <Modal
            open={open}
            onOpenChange={(next) => {
                if (!next && !isPending) onClose()
            }}
            title="Confirm this security change"
            description="Reauthenticate to continue. Your existing session alone is not sufficient."
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
                        disabled={isPending || !value}
                        onClick={onConfirm}
                    >
                        Confirm
                    </button>
                </>
            }
        >
            <div className="grid gap-4">
                <label className={uiClassNames.form.field} htmlFor="reauth-password">
                    <span className={uiClassNames.form.label}>Current password</span>
                    <PasswordInput
                        id="reauth-password"
                        autoComplete="current-password"
                        value={value}
                        onChange={(event) => onChange(event.target.value)}
                    />
                </label>
                <button
                    type="button"
                    className={uiClassNames.button.quiet}
                    disabled={isPending}
                    onClick={onPasskey}
                >
                    Use a passkey instead
                </button>
                {errorMessage ? (
                    <p role="alert" className="text-sm text-danger-text">
                        {errorMessage}
                    </p>
                ) : null}
            </div>
        </Modal>
    )
}
