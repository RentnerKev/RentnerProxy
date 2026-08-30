import { Modal } from '../../../../shared/Modal'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import useRecoveryCodesModalLogic from '../Hooks/useRecoveryCodesModalLogic'

interface RecoveryCodesModalProps {
    readonly codes: ReadonlyArray<string> | null
    readonly onClose: () => void
}
export default function RecoveryCodesModal({ codes, onClose }: RecoveryCodesModalProps) {
    const logic = useRecoveryCodesModalLogic(codes)
    if (!codes) return null
    return (
        <Modal
            open
            onOpenChange={(open) => {
                if (!open) onClose()
            }}
            title="Save your recovery codes"
            description="These codes are shown only once. Each code can be used one time."
            footer={
                <>
                    <button
                        type="button"
                        className={uiClassNames.button.secondary}
                        onClick={logic.handler.copy}
                    >
                        {logic.state.copied ? 'Copied' : 'Copy all'}
                    </button>
                    <button type="button" className={uiClassNames.button.primary} onClick={onClose}>
                        I saved my recovery codes
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
