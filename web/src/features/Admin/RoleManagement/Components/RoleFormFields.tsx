import { getValidationIssue } from '../../../../shared/Forms/Helpers/getFieldErrorMessage'
import useTranslationStore from '../../../../language/useTranslationStore'
import FieldError from '../../../../shared/Forms/FieldError'
import FormMessage from '../../../../shared/Forms/FormMessage'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import type { RoleFormFieldsProps } from '../Types/role-form-modal.types'
import {
    permissionKeysSchema,
    roleDescriptionSchema,
    roleKeySchema,
    roleNameSchema,
} from '../validation'
import PermissionCheckboxes from './PermissionCheckboxes'

export default function RoleFormFields({
    assignablePermissionKeys,
    canEditPermissions,
    errorMessage,
    form,
    formId,
    isCreate,
    role,
}: RoleFormFieldsProps) {
    const { t } = useTranslationStore()
    return (
        <>
            <form.Field
                name="key"
                validators={{ onBlur: ({ value }) => getValidationIssue(roleKeySchema, value) }}
            >
                {(field) => {
                    const hintId = `${formId}-${field.name}-hint`
                    const errorId = `${formId}-${field.name}-error`

                    return (
                        <div className={uiClassNames.form.field}>
                            <label
                                className={uiClassNames.form.label}
                                htmlFor={`${formId}-${field.name}`}
                            >
                                {t('admin.roles.form.key')}
                            </label>
                            <input
                                className={uiClassNames.form.control}
                                id={`${formId}-${field.name}`}
                                name={field.name}
                                maxLength={100}
                                value={field.state.value}
                                disabled={!isCreate}
                                onBlur={field.handleBlur}
                                onChange={(event) => field.handleChange(event.target.value)}
                                aria-describedby={`${hintId} ${errorId}`}
                            />
                            <p id={hintId} className={uiClassNames.form.hint}>
                                {t('admin.roles.form.keyHint')}
                            </p>
                            <FieldError id={errorId} errors={field.state.meta.errors} />
                        </div>
                    )
                }}
            </form.Field>
            <form.Field
                name="name"
                validators={{ onBlur: ({ value }) => getValidationIssue(roleNameSchema, value) }}
            >
                {(field) => {
                    const errorId = `${formId}-${field.name}-error`

                    return (
                        <div className={uiClassNames.form.field}>
                            <label
                                className={uiClassNames.form.label}
                                htmlFor={`${formId}-${field.name}`}
                            >
                                {t('admin.roles.form.name')}
                            </label>
                            <input
                                className={uiClassNames.form.control}
                                id={`${formId}-${field.name}`}
                                name={field.name}
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
                name="description"
                validators={{
                    onBlur: ({ value }) => getValidationIssue(roleDescriptionSchema, value),
                }}
            >
                {(field) => {
                    const errorId = `${formId}-${field.name}-error`

                    return (
                        <div className={`${uiClassNames.form.field} ${uiClassNames.form.wide}`}>
                            <label
                                className={uiClassNames.form.label}
                                htmlFor={`${formId}-${field.name}`}
                            >
                                {t('admin.roles.form.description')}
                            </label>
                            <textarea
                                className={uiClassNames.form.textarea}
                                id={`${formId}-${field.name}`}
                                name={field.name}
                                maxLength={500}
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

            <div className={uiClassNames.form.wide}>
                {canEditPermissions ? (
                    <form.Field
                        name="permissionKeys"
                        mode="array"
                        validators={{
                            onChange: ({ value }) =>
                                getValidationIssue(permissionKeysSchema, value),
                        }}
                    >
                        {(field) => (
                            <PermissionCheckboxes
                                field={field}
                                disabled={false}
                                availablePermissionKeys={assignablePermissionKeys}
                            />
                        )}
                    </form.Field>
                ) : (
                    <fieldset className={uiClassNames.permission.fieldset}>
                        <legend>{t('admin.roles.form.permissions')}</legend>
                        <div className={uiClassNames.chip.row}>
                            {(role?.permissionKeys ?? []).map((permission) => (
                                <span className={uiClassNames.chip.item} key={permission}>
                                    {t(`permissions.${permission}`)}
                                </span>
                            ))}
                        </div>
                        <p className={`${uiClassNames.form.hint} mt-2`}>
                            {t('admin.roles.form.permissionsReadOnly')}
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
