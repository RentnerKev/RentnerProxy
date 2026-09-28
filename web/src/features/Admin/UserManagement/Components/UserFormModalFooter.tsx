import useTranslationStore from '../../../../language/useTranslationStore'
import type { UserFormModalFooterProps } from '../Types/user-form-modal.types'

export default function UserFormModalFooter({
    form,
    formId,
    isPending,
    onOpenChange,
    pendingSubmitLabel,
    submitLabel,
}: UserFormModalFooterProps) {
    const { t } = useTranslationStore()

    return (
        <>
            <button
                type="button"
                className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none border-border-strong bg-surface-raised text-ink-soft enabled:hover:border-brand-600 enabled:hover:text-brand-text"
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
                        className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none bg-brand-500 text-navy-950 enabled:hover:bg-brand-300"
                        disabled={!canSubmit || isSubmitting || isPending}
                    >
                        {isSubmitting || isPending ? pendingSubmitLabel : submitLabel}
                    </button>
                )}
            </form.Subscribe>
        </>
    )
}
