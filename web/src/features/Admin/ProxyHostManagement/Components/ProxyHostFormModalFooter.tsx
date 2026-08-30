import useTranslationStore from '../../../../language/useTranslationStore'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import type { ProxyHostFormModalFooterProps } from '../Types/proxy-host-form.types'

export default function ProxyHostFormModalFooter({
    form,
    formId,
    isPending,
    onOpenChange,
    pendingSubmitLabel,
    submitLabel,
}: ProxyHostFormModalFooterProps) {
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
            <form.Subscribe
                selector={(formState) => [formState.canSubmit, formState.isSubmitting] as const}
            >
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
