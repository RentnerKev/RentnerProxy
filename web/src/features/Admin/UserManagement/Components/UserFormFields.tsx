import {
    displayNameSchema,
    emailSchema,
    getValidationMessage,
} from '../../../Auth/Shared/validation'
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
    return (
        <>
            <form.Field
                name="displayName"
                validators={{
                    onBlur: ({ value }) =>
                        isCreate && !value
                            ? undefined
                            : getValidationMessage(displayNameSchema, value),
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
                                Display name{isCreate ? ' (optional)' : ''}
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
                validators={{ onBlur: ({ value }) => getValidationMessage(emailSchema, value) }}
            >
                {(field) => {
                    const errorId = `${formId}-${field.name}-error`

                    return (
                        <div className={uiClassNames.form.field}>
                            <label
                                className={uiClassNames.form.label}
                                htmlFor={`${formId}-${field.name}`}
                            >
                                Email address
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
                <span className={uiClassNames.form.label}>Status</span>
                <div className="flex min-h-[2.85rem] items-center rounded-xl border border-input-border bg-surface-raised px-[0.85rem]">
                    <span className={statusBadgeClassName} data-status={status}>
                        {status}
                    </span>
                </div>
                <p className={uiClassNames.form.hint}>
                    {isCreate
                        ? 'New accounts remain pending until the invitation is accepted.'
                        : 'Disable access from the user action menu.'}
                </p>
            </div>

            <div className={uiClassNames.form.wide}>
                {canEditRoles ? (
                    <form.Field
                        name="roleKeys"
                        mode="array"
                        validators={{
                            onChange: ({ value }) => getValidationMessage(roleKeysSchema, value),
                        }}
                    >
                        {(field) => <RoleCheckboxes field={field} roles={roles} disabled={false} />}
                    </form.Field>
                ) : (
                    <fieldset className={uiClassNames.permission.fieldset}>
                        <legend>Roles</legend>
                        <div className={uiClassNames.chip.row}>
                            {(user?.roleKeys ?? []).map((role) => (
                                <span className={uiClassNames.chip.item} key={role}>
                                    {role}
                                </span>
                            ))}
                        </div>
                        <p className={`${uiClassNames.form.hint} mt-2`}>
                            You can update profile details, but not this user’s role assignments.
                        </p>
                    </fieldset>
                )}
            </div>

            {errorMessage ? (
                <div className={uiClassNames.form.wide}>
                    <FormMessage tone="error">{errorMessage}</FormMessage>
                </div>
            ) : null}
        </>
    )
}
