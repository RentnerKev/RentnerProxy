import useTranslationStore from '../../../../language/useTranslationStore'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import type { RedirectHostFormModalFooterProps } from '../Types/redirect-host-form.types'
export default function RedirectHostFormModalFooter({
    form,
    formId,
    isPending,
    onOpenChange,
    pendingSubmitLabel,
    submitLabel,
}: RedirectHostFormModalFooterProps) {
    const { t } = useTranslationStore()
    return (
        <>
            <button
                type="button"
                className={uiClassNames.button.secondary}
                disabled={isPending}
                onClick={() => onOpenChange(false)}
            >
                {t('common.cancel')}
            </button>
            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
                {([canSubmit, isSubmitting]) => (
                    <button
                        type="submit"
                        form={formId}
                        className={uiClassNames.button.primary}
                        disabled={!canSubmit || isSubmitting || isPending}
                    >
                        {isSubmitting || isPending ? pendingSubmitLabel : submitLabel}
                    </button>
                )}
            </form.Subscribe>
        </>
    )
}
