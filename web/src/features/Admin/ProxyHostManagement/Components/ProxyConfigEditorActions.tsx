import { RotateCcw } from 'lucide-react'

import {
    ModalActionButton,
    ModalCancelButton,
    ModalSaveButton,
} from '@/shared/Modal/Components/ModalActions.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { ProxyConfigEditorActionsProps } from '../Types/proxy-config-editor-actions.types.ts'

export default function ProxyConfigEditorActions({
    isInvalid = false,
    isBlocked,
    canEdit,
    isBusy,
    isSaving,
    hasData,
    onOpenChange,
    onReset,
    onSave,
}: ProxyConfigEditorActionsProps) {
    const { t } = useTranslationStore()
    return (
        <>
            <ModalCancelButton onClick={() => onOpenChange(false)} disabled={isBusy}>
                {canEdit ? t('common.cancel') : t('common.close')}
            </ModalCancelButton>
            {canEdit ? (
                <>
                    <ModalActionButton
                        variant="danger"
                        onClick={onReset}
                        disabled={isBusy || isBlocked || !hasData}
                    >
                        <RotateCcw className="size-4" />
                        {t('admin.proxyHosts.config.resetButton')}
                    </ModalActionButton>
                    <ModalSaveButton
                        type="button"
                        onClick={onSave}
                        isPending={isSaving}
                        disabled={isBusy || isBlocked || isInvalid || !hasData}
                    />
                </>
            ) : null}
        </>
    )
}
