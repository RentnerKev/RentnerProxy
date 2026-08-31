import useTranslationStore from '../../../../language/useTranslationStore'
import FieldError from '../../../../shared/Forms/FieldError'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import type useCertificateImportLogic from '../Hooks/useCertificateImportLogic'

export default function CertificateImportFields({
    form,
    isPending,
}: {
    readonly form: ReturnType<typeof useCertificateImportLogic>['form']
    readonly isPending: boolean
}) {
    const { t } = useTranslationStore()
    return (
        <div className="grid gap-4">
            <form.Field
                name="name"
                validators={{
                    onBlur: ({ value }) =>
                        value.trim() ? undefined : t('admin.certificates.validation.name'),
                }}
            >
                {(field) => (
                    <div className={uiClassNames.form.field}>
                        <label
                            className={uiClassNames.form.label}
                            htmlFor="certificate-import-name"
                        >
                            {t('admin.certificates.form.name')}
                        </label>
                        <input
                            id="certificate-import-name"
                            name={field.name}
                            className={uiClassNames.form.control}
                            value={field.state.value}
                            maxLength={120}
                            disabled={isPending}
                            onBlur={field.handleBlur}
                            onChange={(event) => field.handleChange(event.target.value)}
                            aria-describedby="certificate-import-name-error"
                        />
                        <FieldError
                            id="certificate-import-name-error"
                            errors={field.state.meta.errors}
                        />
                    </div>
                )}
            </form.Field>
            <PemField
                form={form}
                name="certificatePem"
                label={t('admin.certificates.form.certificatePem')}
                hint={t('admin.certificates.form.certificatePemHint')}
                isPending={isPending}
                required
            />
            <PemField
                form={form}
                name="privateKeyPem"
                label={t('admin.certificates.form.privateKeyPem')}
                hint={t('admin.certificates.form.privateKeyPemHint')}
                isPending={isPending}
                required
            />
            <PemField
                form={form}
                name="chainPem"
                label={t('admin.certificates.form.chainPem')}
                hint={t('admin.certificates.form.chainPemHint')}
                isPending={isPending}
            />
        </div>
    )
}

function PemField({
    form,
    name,
    label,
    hint,
    isPending,
    required,
}: {
    readonly form: ReturnType<typeof useCertificateImportLogic>['form']
    readonly name: 'certificatePem' | 'privateKeyPem' | 'chainPem'
    readonly label: string
    readonly hint: string
    readonly isPending: boolean
    readonly required?: boolean
}) {
    return (
        <form.Field name={name}>
            {(field) => {
                const id = `certificate-import-${name}`
                const errorId = `${id}-error`
                const hintId = `${id}-hint`
                return (
                    <div className={`${uiClassNames.form.field} ${uiClassNames.form.wide}`}>
                        <label className={uiClassNames.form.label} htmlFor={id}>
                            {label}
                            {required ? <span aria-hidden="true"> *</span> : null}
                        </label>
                        <textarea
                            id={id}
                            name={field.name}
                            className={`${uiClassNames.form.textarea} min-h-36 font-mono text-xs`}
                            value={field.state.value ?? ''}
                            disabled={isPending}
                            maxLength={field.name === 'privateKeyPem' ? 64 * 1024 : 256 * 1024}
                            onBlur={field.handleBlur}
                            onChange={(event) => field.handleChange(event.target.value)}
                            autoCapitalize="off"
                            autoComplete="off"
                            spellCheck={false}
                            aria-describedby={`${hintId} ${errorId}`}
                        />
                        <p id={hintId} className={uiClassNames.form.hint}>
                            {hint}
                        </p>
                        <FieldError id={errorId} errors={field.state.meta.errors} />
                    </div>
                )
            }}
        </form.Field>
    )
}
