import useTranslationStore from '../../../../language/useTranslationStore'
import FieldError from '../../../../shared/Forms/FieldError'
import { getValidationIssue } from '../../../../shared/Forms/Helpers/getFieldErrorMessage'
import SelectControl from '../../../../shared/Select'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import type { ProxyHostFormFieldsProps } from '../Types/proxy-host-form.types'
import { proxyForwardHostSchema, proxyHostFormSchema } from '../validation'
import DomainInputs from './DomainInputs'

export default function ProxyHostFormFields({
    addDomain,
    canChangeEnabled,
    domainKeys,
    form,
    formId,
    isPending,
    removeDomain,
}: ProxyHostFormFieldsProps) {
    const { t } = useTranslationStore()

    return (
        <>
            <DomainInputs
                addDomain={addDomain}
                domainKeys={domainKeys}
                form={form}
                formId={formId}
                isPending={isPending}
                removeDomain={removeDomain}
            />
            <form.Field name="forwardScheme">
                {(field) => (
                    <div className={uiClassNames.form.field}>
                        <span className={uiClassNames.form.label}>
                            {t('admin.proxyHosts.form.forwardScheme')}
                        </span>
                        <SelectControl
                            ariaLabel={t('admin.proxyHosts.form.forwardScheme')}
                            className="min-h-[2.85rem]"
                            disabled={isPending}
                            options={[
                                { label: t('admin.proxyHosts.scheme.http'), value: 'http' },
                                { label: t('admin.proxyHosts.scheme.https'), value: 'https' },
                            ]}
                            value={field.state.value}
                            onValueChange={(value) => {
                                if (value === 'http' || value === 'https') field.handleChange(value)
                            }}
                        />
                        <FieldError
                            id={`${formId}-forwardScheme-error`}
                            errors={field.state.meta.errors}
                        />
                    </div>
                )}
            </form.Field>
            <form.Field
                name="forwardPort"
                validators={{
                    onBlur: ({ value }) =>
                        getValidationIssue(proxyHostFormSchema.shape.forwardPort, value),
                }}
            >
                {(field) => {
                    const inputId = `${formId}-${field.name}`
                    const errorId = `${inputId}-error`

                    return (
                        <div className={uiClassNames.form.field}>
                            <label className={uiClassNames.form.label} htmlFor={inputId}>
                                {t('admin.proxyHosts.form.forwardPort')}
                            </label>
                            <input
                                id={inputId}
                                name={field.name}
                                className={uiClassNames.form.control}
                                value={field.state.value}
                                disabled={isPending}
                                inputMode="numeric"
                                maxLength={5}
                                onBlur={field.handleBlur}
                                onChange={(event) => field.handleChange(event.target.value)}
                                aria-invalid={field.state.meta.errors.length > 0}
                                aria-describedby={errorId}
                            />
                            <FieldError id={errorId} errors={field.state.meta.errors} />
                        </div>
                    )
                }}
            </form.Field>
            <form.Field
                name="forwardHost"
                validators={{
                    onBlur: ({ value }) => getValidationIssue(proxyForwardHostSchema, value),
                }}
            >
                {(field) => {
                    const inputId = `${formId}-${field.name}`
                    const errorId = `${inputId}-error`
                    const hintId = `${inputId}-hint`

                    return (
                        <div className={`${uiClassNames.form.field} ${uiClassNames.form.wide}`}>
                            <label className={uiClassNames.form.label} htmlFor={inputId}>
                                {t('admin.proxyHosts.form.forwardHost')}
                            </label>
                            <input
                                id={inputId}
                                name={field.name}
                                className={uiClassNames.form.control}
                                value={field.state.value}
                                maxLength={1_024}
                                disabled={isPending}
                                autoCapitalize="none"
                                autoCorrect="off"
                                spellCheck={false}
                                placeholder={t('admin.proxyHosts.form.forwardHostPlaceholder')}
                                onBlur={field.handleBlur}
                                onChange={(event) => field.handleChange(event.target.value)}
                                aria-invalid={field.state.meta.errors.length > 0}
                                aria-describedby={`${hintId} ${errorId}`}
                            />
                            <p id={hintId} className={uiClassNames.form.hint}>
                                {t('admin.proxyHosts.form.forwardHostHint')}
                            </p>
                            <FieldError id={errorId} errors={field.state.meta.errors} />
                        </div>
                    )
                }}
            </form.Field>
            <form.Field name="enabled">
                {(field) => (
                    <div className={`${uiClassNames.form.field} ${uiClassNames.form.wide}`}>
                        <label
                            className={uiClassNames.permission.option}
                            htmlFor={`${formId}-enabled`}
                            aria-label={t('admin.proxyHosts.status.enabled')}
                        >
                            <input
                                type="checkbox"
                                id={`${formId}-enabled`}
                                name={field.name}
                                className={uiClassNames.permission.checkbox}
                                checked={field.state.value}
                                disabled={isPending || !canChangeEnabled}
                                onBlur={field.handleBlur}
                                onChange={(event) => field.handleChange(event.target.checked)}
                            />
                            <span className={uiClassNames.permission.copy}>
                                <span className={uiClassNames.permission.title}>
                                    {t('admin.proxyHosts.status.enabled')}
                                </span>
                                <span className={uiClassNames.form.hint}>
                                    {t('admin.proxyHosts.form.enabledHint')}
                                </span>
                            </span>
                        </label>
                        {!canChangeEnabled ? (
                            <p className={uiClassNames.form.hint}>
                                {t('admin.proxyHosts.form.statusReadOnly')}
                            </p>
                        ) : null}
                    </div>
                )}
            </form.Field>
        </>
    )
}
