import { EmailInput, TextInput } from '@rentnerkev/inputs'
import { displayNameSchema, emailSchema } from '@/lib/Auth/validation.ts'
import { getValidationIssue } from '@/lib/Forms/fieldErrors.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import FieldError from '@/shared/Forms/FieldError.tsx'
import { roleKeysSchema } from '../../../validation.ts'
import type { UserFormFieldsProps } from '../Types/user-form-modal.types.ts'
import RoleCheckboxes from './RoleCheckboxes.tsx'

const statusBadgeClassName =
    'inline-flex rounded-full bg-neutral px-[0.65rem] py-[0.32rem] text-xs font-extrabold text-muted capitalize data-[status=active]:bg-success-bg data-[status=active]:text-success-text data-[status=disabled]:bg-danger-bg data-[status=disabled]:text-danger-text'

export default function UserFormFields({
    canEditRoles,
    form,
    formId,
    isCreate,
    roles,
    status,
    user,
}: UserFormFieldsProps) {
    const { t } = useTranslationStore()
    return (
        <>
            <form.Field
                name="displayName"
                validators={{
                    onBlur: ({ value }) =>
                        isCreate && !value
                            ? undefined
                            : getValidationIssue(displayNameSchema, value),
                }}
            >
                {(field) => {
                    const errorId = `${formId}-${field.name}-error`

                    return (
                        <div className="grid gap-[0.45rem]">
                            <label
                                className="text-[0.82rem] font-[750] text-ink-soft"
                                htmlFor={`${formId}-${field.name}`}
                            >
                                {t('admin.users.form.displayName')}
                                {isCreate ? ` (${t('admin.users.form.optional')})` : ''}
                            </label>
                            <TextInput
                                id={`${formId}-${field.name}`}
                                name={field.name}
                                autoComplete={isCreate ? 'off' : 'name'}
                                maxLength={100}
                                value={field.state.value}
                                onBlur={field.handleBlur}
                                onValueChange={field.handleChange}
                                aria-describedby={errorId}
                            />
                            <FieldError id={errorId} errors={field.state.meta.errors} />
                        </div>
                    )
                }}
            </form.Field>
            <form.Field
                name="email"
                validators={{ onBlur: ({ value }) => getValidationIssue(emailSchema, value) }}
            >
                {(field) => {
                    const errorId = `${formId}-${field.name}-error`

                    return (
                        <div className="grid gap-[0.45rem]">
                            <label
                                className="text-[0.82rem] font-[750] text-ink-soft"
                                htmlFor={`${formId}-${field.name}`}
                            >
                                {t('admin.users.form.email')}
                            </label>
                            <EmailInput
                                id={`${formId}-${field.name}`}
                                name={field.name}
                                type="email"
                                inputMode="email"
                                autoComplete={isCreate ? 'off' : 'email'}
                                maxLength={254}
                                value={field.state.value}
                                onBlur={field.handleBlur}
                                onValueChange={field.handleChange}
                                aria-describedby={errorId}
                            />
                            <FieldError id={errorId} errors={field.state.meta.errors} />
                        </div>
                    )
                }}
            </form.Field>

            <div className="grid gap-[0.45rem]">
                <span className="text-[0.82rem] font-[750] text-ink-soft">
                    {t('admin.users.form.status')}
                </span>
                <div className="flex min-h-12 items-center rounded-xl border border-input-border bg-surface-raised px-[0.85rem]">
                    <span className={statusBadgeClassName} data-status={status}>
                        {t(`admin.users.status.${status}`)}
                    </span>
                </div>
                <p className="m-0 text-[0.76rem] leading-[1.45] text-muted">
                    {isCreate
                        ? t('admin.users.form.pendingHint')
                        : t('admin.users.form.disabledHint')}
                </p>
            </div>

            <div className="shell:col-span-full">
                {canEditRoles ? (
                    <form.Field
                        name="roleKeys"
                        mode="array"
                        validators={{
                            onChange: ({ value }) => getValidationIssue(roleKeysSchema, value),
                        }}
                    >
                        {(field) => <RoleCheckboxes field={field} roles={roles} disabled={false} />}
                    </form.Field>
                ) : (
                    <fieldset className="m-0 min-w-0 border-0 p-0 [&_legend]:mb-[0.55rem] [&_legend]:text-[0.82rem] [&_legend]:font-[750] [&_legend]:text-ink-soft">
                        <legend>{t('admin.users.form.roles')}</legend>
                        <div className="flex flex-wrap gap-[0.45rem]">
                            {(user?.roleKeys ?? []).map((role) => (
                                <span
                                    className="inline-flex items-center rounded-full border border-success-text/20 bg-success-bg px-[0.6rem] py-[0.28rem] font-mono text-[0.65rem] font-bold text-success-text"
                                    key={role}
                                >
                                    {['owner', 'admin', 'viewer'].includes(role)
                                        ? t(`systemRoles.${role}.name`)
                                        : role}
                                </span>
                            ))}
                        </div>
                        <p className="m-0 text-[0.76rem] leading-[1.45] text-muted mt-2">
                            {t('admin.users.form.rolesReadOnly')}
                        </p>
                    </fieldset>
                )}
            </div>
        </>
    )
}
