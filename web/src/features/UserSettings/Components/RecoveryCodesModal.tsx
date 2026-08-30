import { Modal } from '../../../shared/Modal'
import { uiClassNames } from '../../../shared/Styles/uiClassNames'
import useTranslationStore from '../../../language/useTranslationStore'
import useRecoveryCodesModalLogic from '../Hooks/useRecoveryCodesModalLogic'

interface RecoveryCodesModalProps {
    readonly codes: ReadonlyArray<string> | null
    readonly onClose: () => void
}
export default function RecoveryCodesModal({ codes, onClose }: RecoveryCodesModalProps) {
    const logic = useRecoveryCodesModalLogic(codes)
    const { t } = useTranslationStore()
    if (!codes) return null
    return (
        <Modal
            open
            onOpenChange={(open) => {
                if (!open) onClose()
            }}
            title={t('account.recoveryCodes.title')}
            description={t('account.recoveryCodes.description')}
            footer={
                <>
                    <button
                        type="button"
                        className={uiClassNames.button.secondary}
                        onClick={logic.handler.copy}
                    >
                        {logic.state.copied
                            ? t('account.recoveryCodes.copied')
                            : t('account.recoveryCodes.copyAll')}
                    </button>
                    <button type="button" className={uiClassNames.button.primary} onClick={onClose}>
                        {t('account.recoveryCodes.saved')}
                    </button>
                </>
            }
        >
            <div className="grid gap-2 rounded-xl border border-border bg-surface-raised p-4 font-mono text-sm text-ink-soft">
                {codes.map((code) => (
                    <code key={code}>{code}</code>
                ))}
            </div>
        </Modal>
    )
}
