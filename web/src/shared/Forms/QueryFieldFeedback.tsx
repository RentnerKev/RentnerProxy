import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { QueryFieldFeedbackProps } from './Types/query-field-feedback.types.ts'

export default function QueryFieldFeedback({
    isLoading,
    isError,
    isPending,
    onRetry,
}: QueryFieldFeedbackProps) {
    const { t } = useTranslationStore()
    return isLoading ? (
        <output className="m-0 text-[0.76rem] leading-[1.45] text-muted">
            {t('common.loading')}
        </output>
    ) : isError ? (
        <div className="flex flex-wrap items-center gap-2" role="alert">
            <p className="m-0 text-sm text-danger-text">{t('common.requestFailed')}</p>
            <button
                type="button"
                className={buttonClassName('ghost')}
                onClick={onRetry}
                disabled={isPending}
            >
                {t('common.retry')}
            </button>
        </div>
    ) : null
}
