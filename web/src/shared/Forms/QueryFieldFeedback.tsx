import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { QueryFieldFeedbackProps } from './Types/query-field-feedback.types.ts'

export default function QueryFieldFeedback({ isLoading, isError }: QueryFieldFeedbackProps) {
    const { t } = useTranslationStore()
    return isLoading ? (
        <output className="m-0 text-[0.76rem] leading-[1.45] text-muted">
            {t('common.loading')}
        </output>
    ) : isError ? (
        <div className="flex flex-wrap items-center gap-2" role="alert">
            <p className="m-0 text-sm text-danger-text">{t('common.requestFailed')}</p>
        </div>
    ) : null
}
