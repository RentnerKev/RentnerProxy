import { Modal } from '../../../shared/Modal'
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
                        className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none border-border-strong bg-surface-raised text-ink-soft enabled:hover:border-accent-border enabled:hover:text-accent-ring"
                        onClick={() => void logic.handler.copy()}
                    >
                        {logic.state.copied
                            ? t('account.recoveryCodes.copied')
                            : t('account.recoveryCodes.copyAll')}
                    </button>
                    <button
                        type="button"
                        className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none bg-accent text-accent-foreground enabled:hover:bg-accent-hover"
                        onClick={onClose}
                    >
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
