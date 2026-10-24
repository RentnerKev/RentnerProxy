import { CheckboxInput } from '@rentnerkev/inputs'
import HostTagSelect from '@/features/Admin/HostTags/Components/HostTagSelect.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { ProxyHostOptionsFieldsProps } from '../Types/form-sections.types.ts'

export default function ProxyHostOptionsFields({
    form,
    formId,
    isPending,
    canChangeEnabled,
}: ProxyHostOptionsFieldsProps) {
    const { t } = useTranslationStore()
    return (
        <>
            <form.Field name="enabled">
                {(field) => (
                    <div className="grid gap-[0.45rem] shell:col-span-full">
                        <label
                            className="flex cursor-pointer items-start gap-[0.65rem] rounded-[0.7rem] border border-border bg-surface-raised p-[0.65rem]"
                            htmlFor={`${formId}-enabled`}
                            aria-label={t('admin.proxyHosts.status.enabled')}
                        >
                            <CheckboxInput
                                type="checkbox"
                                id={`${formId}-enabled`}
                                name={field.name}
                                checked={field.state.value}
                                disabled={isPending || !canChangeEnabled}
                                onBlur={field.handleBlur}
                                onChange={(event) => field.handleChange(event.target.checked)}
                            />
                            <span className="grid gap-[0.12rem]">
                                <span className="text-[0.78rem] text-ink-soft">
                                    {t('admin.proxyHosts.status.enabled')}
                                </span>
                                <span className="m-0 text-[0.76rem] leading-[1.45] text-muted">
                                    {t('admin.proxyHosts.form.enabledHint')}
                                </span>
                            </span>
                        </label>
                        {!canChangeEnabled ? (
                            <p className="m-0 text-[0.76rem] leading-[1.45] text-muted">
                                {t('admin.proxyHosts.form.statusReadOnly')}
                            </p>
                        ) : null}
                    </div>
                )}
            </form.Field>
            <form.Field name="tagIds">
                {(field) => (
                    <HostTagSelect
                        kind="proxy"
                        value={field.state.value ?? []}
                        onChange={field.handleChange}
                        disabled={isPending}
                    />
                )}
            </form.Field>
        </>
    )
}
