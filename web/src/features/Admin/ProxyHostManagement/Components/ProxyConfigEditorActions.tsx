import { RotateCcw, Save } from 'lucide-react'

import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { ProxyConfigEditorActionsProps } from '../Types/proxy-config-editor-actions.types.ts'

export default function ProxyConfigEditorActions({
    isBlocked,
    canEdit,
    isBusy,
    hasData,
    onOpenChange,
    onReset,
    onSave,
}: ProxyConfigEditorActionsProps) {
    const { t } = useTranslationStore()
    return (
        <>
            <button
                type="button"
                className={buttonClassName('secondary')}
                onClick={() => onOpenChange(false)}
                disabled={isBusy}
            >
                {t('common.cancel')}
            </button>
            {canEdit ? (
                <>
                    <button
                        type="button"
                        className={buttonClassName('danger')}
                        onClick={onReset}
                        disabled={isBusy || isBlocked || !hasData}
                    >
                        <RotateCcw className="size-4" />
                        {t('admin.proxyHosts.config.resetButton')}
                    </button>
                    <button
                        type="button"
                        className={buttonClassName('primary')}
                        onClick={onSave}
                        disabled={isBusy || isBlocked || !hasData}
                    >
                        <Save className="size-4" />
                        {t('admin.proxyHosts.config.save')}
                    </button>
                </>
            ) : null}
        </>
    )
}
