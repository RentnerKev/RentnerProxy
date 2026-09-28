import { TextInput, Textarea } from '@rentnerkev/inputs'
import { getValidationIssue } from '../../../../shared/Forms/Helpers/getFieldErrorMessage'
import useTranslationStore from '../../../../language/useTranslationStore'
import FieldError from '../../../../shared/Forms/FieldError'
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
                        <div className="grid gap-[0.45rem]">
                            <label
                                className="text-[0.82rem] font-[750] text-ink-soft"
                                htmlFor={`${formId}-${field.name}`}
                            >
                                {t('admin.roles.form.key')}
                            </label>
                            <TextInput
                                id={`${formId}-${field.name}`}
                                name={field.name}
                                maxLength={100}
                                value={field.state.value}
                                disabled={!isCreate}
                                onBlur={field.handleBlur}
                                onChange={(event) => field.handleChange(event.target.value)}
                                aria-describedby={`${hintId} ${errorId}`}
                            />
                            <p id={hintId} className="m-0 text-[0.76rem] leading-[1.45] text-muted">
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
                        <div className="grid gap-[0.45rem]">
                            <label
                                className="text-[0.82rem] font-[750] text-ink-soft"
                                htmlFor={`${formId}-${field.name}`}
                            >
                                {t('admin.roles.form.name')}
                            </label>
                            <TextInput
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
                        <div className="grid gap-[0.45rem] shell:col-span-full">
                            <label
                                className="text-[0.82rem] font-[750] text-ink-soft"
                                htmlFor={`${formId}-${field.name}`}
                            >
                                {t('admin.roles.form.description')}
                            </label>
                            <Textarea
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

            <div className="shell:col-span-full">
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
                    <fieldset className="m-0 min-w-0 border-0 p-0 [&_legend]:mb-[0.55rem] [&_legend]:text-[0.82rem] [&_legend]:font-[750] [&_legend]:text-ink-soft">
                        <legend>{t('admin.roles.form.permissions')}</legend>
                        <div className="flex flex-wrap gap-[0.45rem]">
                            {(role?.permissionKeys ?? []).map((permission) => (
                                <span
                                    className="inline-flex items-center rounded-full border border-brand-600/20 bg-success-bg px-[0.6rem] py-[0.28rem] font-mono text-[0.65rem] font-bold text-success-text"
                                    key={permission}
                                >
                                    {t(`permissions.${permission}`)}
                                </span>
                            ))}
                        </div>
                        <p className="m-0 text-[0.76rem] leading-[1.45] text-muted mt-2">
                            {t('admin.roles.form.permissionsReadOnly')}
                        </p>
                    </fieldset>
                )}
            </div>
        </>
    )
}
