import type { RecoveryCodesModalProps } from './Types/recovery-codes-modal-props.types.ts'
import { Modal } from '@/shared/Modal/index.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useRecoveryCodesModalLogic from './Hooks/useRecoveryCodesModalLogic.ts'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'

export default function RecoveryCodesModal({ codes, onClose }: RecoveryCodesModalProps) {
    const logic = useRecoveryCodesModalLogic(codes, onClose)
    const { t } = useTranslationStore()
    if (!codes) return null
    return (
        <Modal
            open
            onOpenChange={logic.handler.handleOpenChange}
            title={t('account.recoveryCodes.title')}
            description={t('account.recoveryCodes.description')}
            footer={
                <>
                    <button
                        type="button"
                        className={buttonClassName('secondary')}
                        onClick={() => void logic.handler.copy()}
                    >
                        {logic.state.copied
                            ? t('account.recoveryCodes.copied')
                            : t('account.recoveryCodes.copyAll')}
                    </button>
                    <button type="button" className={buttonClassName('primary')} onClick={onClose}>
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
