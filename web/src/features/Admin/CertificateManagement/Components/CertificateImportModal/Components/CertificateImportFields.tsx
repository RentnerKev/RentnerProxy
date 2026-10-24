import { TextInput, Textarea } from '@rentnerkev/inputs'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import FieldError from '@/shared/Forms/FieldError.tsx'
import type { CertificateImportFieldsProps } from '../Types/certificate-import-modal.types.ts'

export default function CertificateImportFields({ form, isPending }: CertificateImportFieldsProps) {
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
                    <div className="grid gap-[0.45rem]">
                        <label
                            className="text-[0.82rem] font-[750] text-ink-soft"
                            htmlFor="certificate-import-name"
                        >
                            {t('admin.certificates.form.name')}
                        </label>
                        <TextInput
                            id="certificate-import-name"
                            placeholder={t('placeholders.certificateName')}
                            name={field.name}
                            value={field.state.value}
                            maxLength={120}
                            disabled={isPending}
                            onBlur={field.handleBlur}
                            onValueChange={field.handleChange}
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
                placeholder={t('placeholders.certificatePem')}
                label={t('admin.certificates.form.certificatePem')}
                isPending={isPending}
                required
            />
            <PemField
                form={form}
                name="privateKeyPem"
                placeholder={t('placeholders.privateKeyPem')}
                label={t('admin.certificates.form.privateKeyPem')}
                isPending={isPending}
                required
            />
            <PemField
                form={form}
                name="chainPem"
                placeholder={t('placeholders.certificateChainPem')}
                label={t('admin.certificates.form.chainPem')}
                isPending={isPending}
            />
        </div>
    )
}

function PemField({
    form,
    name,
    label,
    placeholder,
    isPending,
    required,
}: {
    readonly form: CertificateImportFieldsProps['form']
    readonly name: 'certificatePem' | 'privateKeyPem' | 'chainPem'
    readonly label: string
    readonly placeholder: string
    readonly isPending: boolean
    readonly required?: boolean
}) {
    return (
        <form.Field name={name}>
            {(field) => {
                const id = `certificate-import-${name}`
                const errorId = `${id}-error`
                return (
                    <div className="grid gap-[0.45rem] shell:col-span-full">
                        <label className="text-[0.82rem] font-[750] text-ink-soft" htmlFor={id}>
                            {label}
                            {required ? <span aria-hidden="true"> *</span> : null}
                        </label>
                        <Textarea
                            id={id}
                            placeholder={placeholder}
                            name={field.name}
                            className="box-border w-full rounded-xl border border-input-border bg-surface-raised px-3 text-sm text-ink transition-[border-color,box-shadow] duration-150 placeholder:text-muted-soft aria-invalid:border-red-500 disabled:cursor-not-allowed disabled:opacity-[0.55] focus:border-accent-border focus:outline-hidden focus:ring-[3px] focus:ring-accent-ring/20 motion-reduce:transition-none min-h-26 resize-y py-3 min-h-36 font-mono text-xs"
                            value={field.state.value ?? ''}
                            disabled={isPending}
                            maxLength={field.name === 'privateKeyPem' ? 64 * 1024 : 256 * 1024}
                            onBlur={field.handleBlur}
                            onValueChange={field.handleChange}
                            autoCapitalize="off"
                            autoComplete="off"
                            spellCheck={false}
                            aria-describedby={errorId}
                        />
                        <FieldError id={errorId} errors={field.state.meta.errors} />
                    </div>
                )
            }}
        </form.Field>
    )
}
