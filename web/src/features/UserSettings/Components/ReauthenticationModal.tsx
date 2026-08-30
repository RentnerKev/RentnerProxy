import { Modal } from '../../../shared/Modal'
import PasswordInput from '../../../shared/Forms/PasswordInput'
import { uiClassNames } from '../../../shared/Styles/uiClassNames'
import useTranslationStore from '../../../language/useTranslationStore'

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
    const { t } = useTranslationStore()

    return (
        <Modal
            open={open}
            onOpenChange={(next) => {
                if (!next && !isPending) onClose()
            }}
            title={t('account.reauthentication.title')}
            description={t('account.reauthentication.description')}
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
                        disabled={isPending || !value}
                        onClick={onConfirm}
                    >
                        {t('account.reauthentication.confirm')}
                    </button>
                </>
            }
        >
            <div className="grid gap-4">
                <label className={uiClassNames.form.field} htmlFor="reauth-password">
                    <span className={uiClassNames.form.label}>
                        {t('account.reauthentication.currentPassword')}
                    </span>
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
                    {t('account.reauthentication.usePasskey')}
                </button>
                {errorMessage ? (
                    <p role="alert" className="text-sm text-danger-text">
                        {t(errorMessage)}
                    </p>
                ) : null}
            </div>
        </Modal>
    )
}
