import { displayNameSchema, emailSchema } from '../../../Auth/Shared/validation'
import { getValidationIssue } from '../../../../shared/Forms/Helpers/getFieldErrorMessage'
import useTranslationStore from '../../../../language/useTranslationStore'
import FieldError from '../../../../shared/Forms/FieldError'
import FormMessage from '../../../../shared/Forms/FormMessage'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import { roleKeysSchema } from '../validation'
import type { UserFormFieldsProps } from '../Types/user-form-modal.types'
import RoleCheckboxes from './RoleCheckboxes'

const statusBadgeClassName =
    'inline-flex rounded-full bg-neutral px-[0.65rem] py-[0.32rem] text-xs font-extrabold text-muted capitalize data-[status=active]:bg-success-bg data-[status=active]:text-success-text data-[status=disabled]:bg-danger-bg data-[status=disabled]:text-danger-text'

export default function UserFormFields({
    canEditRoles,
    errorMessage,
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
                        <div className={uiClassNames.form.field}>
                            <label
                                className={uiClassNames.form.label}
                                htmlFor={`${formId}-${field.name}`}
                            >
                                {t('admin.users.form.displayName')}
                                {isCreate ? ` (${t('admin.users.form.optional')})` : ''}
                            </label>
                            <input
                                className={uiClassNames.form.control}
                                id={`${formId}-${field.name}`}
                                name={field.name}
                                autoComplete={isCreate ? 'off' : 'name'}
                                maxLength={100}
                                value={field.state.value}
                                onBlur={field.handleBlur}
                                onChange={(event) => field.handleChange(event.target.value)}
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
                        <div className={uiClassNames.form.field}>
                            <label
                                className={uiClassNames.form.label}
                                htmlFor={`${formId}-${field.name}`}
                            >
                                {t('admin.users.form.email')}
                            </label>
                            <input
                                className={uiClassNames.form.control}
                                id={`${formId}-${field.name}`}
                                name={field.name}
                                type="email"
                                inputMode="email"
                                autoComplete={isCreate ? 'off' : 'email'}
                                maxLength={254}
                                value={field.state.value}
                                onBlur={field.handleBlur}
                                onChange={(event) => field.handleChange(event.target.value)}
                                aria-describedby={errorId}
                            />
                            <FieldError id={errorId} errors={field.state.meta.errors} />
                        </div>
                    )
                }}
            </form.Field>

            <div className={uiClassNames.form.field}>
                <span className={uiClassNames.form.label}>{t('admin.users.form.status')}</span>
                <div className="flex min-h-[2.85rem] items-center rounded-xl border border-input-border bg-surface-raised px-[0.85rem]">
                    <span className={statusBadgeClassName} data-status={status}>
                        {t(`admin.users.status.${status}`)}
                    </span>
                </div>
                <p className={uiClassNames.form.hint}>
                    {isCreate
                        ? t('admin.users.form.pendingHint')
                        : t('admin.users.form.disabledHint')}
                </p>
            </div>

            <div className={uiClassNames.form.wide}>
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
                    <fieldset className={uiClassNames.permission.fieldset}>
                        <legend>{t('admin.users.form.roles')}</legend>
                        <div className={uiClassNames.chip.row}>
                            {(user?.roleKeys ?? []).map((role) => (
                                <span className={uiClassNames.chip.item} key={role}>
                                    {['owner', 'admin', 'viewer'].includes(role)
                                        ? t(`systemRoles.${role}.name`)
                                        : role}
                                </span>
                            ))}
                        </div>
                        <p className={`${uiClassNames.form.hint} mt-2`}>
                            {t('admin.users.form.rolesReadOnly')}
                        </p>
                    </fieldset>
                )}
            </div>

            {errorMessage ? (
                <div className={uiClassNames.form.wide}>
                    <FormMessage tone="error">{t(errorMessage)}</FormMessage>
                </div>
            ) : null}
        </>
    )
}
