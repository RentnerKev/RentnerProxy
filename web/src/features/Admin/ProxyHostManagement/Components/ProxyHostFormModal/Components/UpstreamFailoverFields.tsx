import { CheckboxInput, NumberInput, TextInput } from '@rentnerkev/inputs'
import FieldError from '@/shared/Forms/FieldError.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useUpstreamFailoverFieldsLogic from '../Hooks/useUpstreamFailoverFieldsLogic.ts'
import type { UpstreamFailoverFieldsProps } from '../Types/upstream-failover-fields.types.ts'

/** Presents opt-in probes, passive tracking and dependent retries with editable numeric drafts and schema errors. */
export default function UpstreamFailoverFields(props: UpstreamFailoverFieldsProps) {
    const { form, formId, isPending } = props
    const { t } = useTranslationStore()
    const { state, handler } = useUpstreamFailoverFieldsLogic(props)
    return (
        <fieldset className="m-0 grid min-w-0 gap-3 rounded-xl border border-border p-3">
            <legend className="text-sm font-bold">
                {t('admin.proxyHosts.upstreamFailover.title')}
            </legend>
            <form.Field name="upstreamPool.failover">
                {(field) => (
                    <FieldError id={`${formId}-failover-error`} errors={field.state.meta.errors} />
                )}
            </form.Field>
            {state.sections.map((section) => (
                <div key={section.feature} className="grid gap-3">
                    <label
                        className="flex items-center gap-2"
                        htmlFor={`${formId}-failover-${section.feature}`}
                    >
                        <CheckboxInput
                            id={`${formId}-failover-${section.feature}`}
                            checked={section.enabled}
                            disabled={section.disabled}
                            aria-describedby={`${formId}-failover-${section.feature}-hint`}
                            onChange={(event) =>
                                handler.handleToggle(section.feature, event.target.checked)
                            }
                        />
                        <span className="text-sm font-bold">
                            {t(`admin.proxyHosts.upstreamFailover.${section.feature}`)}
                        </span>
                    </label>
                    <p
                        id={`${formId}-failover-${section.feature}-hint`}
                        className="m-0 text-xs leading-relaxed text-muted"
                    >
                        {t(`admin.proxyHosts.upstreamFailover.${section.feature}Hint`)}
                    </p>
                    {section.enabled ? (
                        <>
                            <form.Field name={`upstreamPool.failover.${section.feature}`}>
                                {(field) => (
                                    <FieldError
                                        id={`${formId}-failover-${section.feature}-error`}
                                        errors={field.state.meta.errors}
                                    />
                                )}
                            </form.Field>
                            {section.feature === 'active' ? (
                                <form.Field name="upstreamPool.failover.active.path">
                                    {(field) => (
                                        <div className="grid gap-1">
                                            <label htmlFor={`${formId}-failover-path`}>
                                                {t('admin.proxyHosts.upstreamFailover.path')}
                                            </label>
                                            <TextInput
                                                id={`${formId}-failover-path`}
                                                name={field.name}
                                                value={field.state.value ?? ''}
                                                disabled={isPending}
                                                maxLength={2048}
                                                placeholder={t(
                                                    'admin.proxyHosts.upstreamFailover.pathPlaceholder',
                                                )}
                                                autoCapitalize="none"
                                                autoCorrect="off"
                                                spellCheck={false}
                                                onValueChange={handler.handlePathChange}
                                                onBlur={field.handleBlur}
                                                aria-invalid={field.state.meta.errors.length > 0}
                                                aria-describedby={`${formId}-failover-path-error`}
                                            />
                                            <FieldError
                                                id={`${formId}-failover-path-error`}
                                                errors={field.state.meta.errors}
                                            />
                                        </div>
                                    )}
                                </form.Field>
                            ) : null}
                            <div className="grid gap-3 shell:grid-cols-2">
                                {section.fields.map((setting) => (
                                    <form.Field key={setting.name} name={setting.name}>
                                        {(field) => (
                                            <div className="grid gap-1">
                                                <label htmlFor={`${formId}-${setting.name}`}>
                                                    {t(
                                                        `admin.proxyHosts.upstreamFailover.${setting.label}`,
                                                    )}
                                                </label>
                                                <NumberInput
                                                    id={`${formId}-${setting.name}`}
                                                    name={field.name}
                                                    value={field.state.value ?? ''}
                                                    disabled={isPending}
                                                    min={setting.min}
                                                    max={setting.max}
                                                    step={1}
                                                    placeholder={setting.placeholder}
                                                    validationMode="external"
                                                    onValueChange={(value) =>
                                                        handler.handleNumberChange(
                                                            setting.name,
                                                            value,
                                                        )
                                                    }
                                                    onBlur={field.handleBlur}
                                                    aria-invalid={
                                                        field.state.meta.errors.length > 0
                                                    }
                                                    aria-describedby={`${formId}-${setting.name}-error`}
                                                />
                                                <FieldError
                                                    id={`${formId}-${setting.name}-error`}
                                                    errors={field.state.meta.errors}
                                                />
                                            </div>
                                        )}
                                    </form.Field>
                                ))}
                            </div>
                        </>
                    ) : null}
                </div>
            ))}
        </fieldset>
    )
}
