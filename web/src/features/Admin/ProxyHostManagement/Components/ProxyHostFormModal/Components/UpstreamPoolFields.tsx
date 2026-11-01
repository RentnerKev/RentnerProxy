import { TextInput } from '@rentnerkev/inputs'
import { CustomSelect } from '@rentnerkev/select/select'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
import FieldError from '@/shared/Forms/FieldError.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { getValidationIssue } from '@/lib/Forms/fieldErrors.ts'
import { proxyForwardHostSchema, proxyHostFormSchema } from '../../../validation.ts'
import type { UpstreamPoolEditorProps } from '../Types/upstream-pool-fields.types.ts'

export default function UpstreamPoolFields({
    form,
    formId,
    isPending,
    state,
    handler,
}: UpstreamPoolEditorProps) {
    const { t } = useTranslationStore()
    return (
        <fieldset className="m-0 grid min-w-0 gap-3 border-0 p-0 shell:col-span-full">
            <legend className="mb-2 text-sm font-bold">
                {t('admin.proxyHosts.upstreamPool.title')}
            </legend>
            <CustomSelect
                id={`${formId}-upstream-mode`}
                label={t('admin.proxyHosts.upstreamPool.policy')}
                aria-label={t('admin.proxyHosts.upstreamPool.policy')}
                disabled={isPending}
                value={state.pool?.policy ?? 'single'}
                onValueChange={handler.handleModeChange}
                options={[
                    { value: 'single', label: t('admin.proxyHosts.upstreamPool.single') },
                    { value: 'round_robin', label: t('admin.proxyHosts.upstreamPool.round_robin') },
                    { value: 'first', label: t('admin.proxyHosts.upstreamPool.first') },
                ]}
            />
            {state.pool ? (
                <>
                    <p className="m-0 text-xs text-muted">
                        {t('admin.proxyHosts.upstreamPool.hint')}
                    </p>
                    <p className="m-0 text-xs text-muted">
                        {t('admin.proxyHosts.upstreamPool.tlsHint')}
                    </p>
                    <form.Field name="upstreamPool">
                        {(field) => (
                            <FieldError
                                id={`${formId}-upstreamPool-error`}
                                errors={field.state.meta.errors}
                            />
                        )}
                    </form.Field>
                    {state.pool.members.map((_member, index) => (
                        <div
                            key={state.memberKeys[index]}
                            className="grid gap-2 rounded-xl border border-border p-3"
                        >
                            <p className="m-0 text-sm font-bold">
                                {t(
                                    index === 0
                                        ? 'admin.proxyHosts.upstreamPool.primary'
                                        : 'admin.proxyHosts.upstreamPool.member',
                                    { number: index + 1 },
                                )}
                            </p>
                            <form.Field name={`upstreamPool.members[${index}]`}>
                                {(field) => (
                                    <FieldError
                                        id={`${formId}-upstream-${index}-error`}
                                        errors={field.state.meta.errors}
                                    />
                                )}
                            </form.Field>
                            {index > 0 ? (
                                <div className="grid gap-3 shell:grid-cols-2">
                                    <form.Field
                                        name={`upstreamPool.members[${index}].host`}
                                        validators={{
                                            onBlur: ({ value }) =>
                                                getValidationIssue(proxyForwardHostSchema, value),
                                        }}
                                    >
                                        {(field) => (
                                            <div className="grid gap-1">
                                                <label htmlFor={`${formId}-upstream-${index}-host`}>
                                                    {t('admin.proxyHosts.form.forwardHost')}
                                                </label>
                                                <TextInput
                                                    id={`${formId}-upstream-${index}-host`}
                                                    name={field.name}
                                                    value={field.state.value ?? ''}
                                                    disabled={isPending}
                                                    maxLength={1024}
                                                    autoCapitalize="none"
                                                    autoCorrect="off"
                                                    spellCheck={false}
                                                    onBlur={field.handleBlur}
                                                    onValueChange={(value) =>
                                                        handler.handleMemberHostChange(index, value)
                                                    }
                                                    aria-invalid={
                                                        field.state.meta.errors.length > 0
                                                    }
                                                    aria-describedby={`${formId}-upstream-${index}-host-error`}
                                                />
                                                <FieldError
                                                    id={`${formId}-upstream-${index}-host-error`}
                                                    errors={field.state.meta.errors}
                                                />
                                            </div>
                                        )}
                                    </form.Field>
                                    <form.Field
                                        name={`upstreamPool.members[${index}].port`}
                                        validators={{
                                            onBlur: ({ value }) =>
                                                getValidationIssue(
                                                    proxyHostFormSchema.shape.forwardPort,
                                                    value,
                                                ),
                                        }}
                                    >
                                        {(field) => (
                                            <div className="grid gap-1">
                                                <label htmlFor={`${formId}-upstream-${index}-port`}>
                                                    {t('admin.proxyHosts.form.forwardPort')}
                                                </label>
                                                <TextInput
                                                    id={`${formId}-upstream-${index}-port`}
                                                    name={field.name}
                                                    value={field.state.value ?? ''}
                                                    disabled={isPending}
                                                    maxLength={5}
                                                    inputMode="numeric"
                                                    onBlur={field.handleBlur}
                                                    onValueChange={(value) =>
                                                        handler.handleMemberPortChange(index, value)
                                                    }
                                                    aria-invalid={
                                                        field.state.meta.errors.length > 0
                                                    }
                                                    aria-describedby={`${formId}-upstream-${index}-port-error`}
                                                />
                                                <FieldError
                                                    id={`${formId}-upstream-${index}-port-error`}
                                                    errors={field.state.meta.errors}
                                                />
                                            </div>
                                        )}
                                    </form.Field>
                                </div>
                            ) : null}
                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    className={buttonClassName('secondary', 'text-xs')}
                                    disabled={isPending || index === 0}
                                    onClick={() => handler.handleMove(index, -1)}
                                    aria-label={t('admin.proxyHosts.upstreamPool.moveUpLabel', {
                                        number: index + 1,
                                    })}
                                >
                                    {t('admin.proxyHosts.upstreamPool.moveUp')}
                                </button>
                                <button
                                    type="button"
                                    className={buttonClassName('secondary', 'text-xs')}
                                    disabled={isPending || index === state.pool!.members.length - 1}
                                    onClick={() => handler.handleMove(index, 1)}
                                    aria-label={t('admin.proxyHosts.upstreamPool.moveDownLabel', {
                                        number: index + 1,
                                    })}
                                >
                                    {t('admin.proxyHosts.upstreamPool.moveDown')}
                                </button>
                                <button
                                    type="button"
                                    className={buttonClassName('secondary', 'text-xs')}
                                    disabled={isPending || state.pool!.members.length <= 1}
                                    onClick={() => handler.handleRemove(index)}
                                    aria-label={t('admin.proxyHosts.upstreamPool.removeLabel', {
                                        number: index + 1,
                                    })}
                                >
                                    {t('admin.proxyHosts.upstreamPool.remove')}
                                </button>
                            </div>
                        </div>
                    ))}
                    <button
                        type="button"
                        className={buttonClassName('secondary', 'justify-self-start text-sm')}
                        disabled={isPending || !state.canAdd}
                        onClick={handler.handleAdd}
                    >
                        {t('admin.proxyHosts.upstreamPool.add')}
                    </button>
                </>
            ) : null}
        </fieldset>
    )
}
