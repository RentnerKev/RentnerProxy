import { getValidationMessage } from '../../../Auth/Shared/validation'
import FieldError from '../../../../shared/Forms/FieldError'
import FormMessage from '../../../../shared/Forms/FormMessage'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import useRoleEditorLogic from '../Hooks/useRoleEditorLogic'
import type { RoleEditorProps } from '../Types/role-management-component-props.types'
import {
    permissionKeysSchema,
    roleDescriptionSchema,
    roleKeySchema,
    roleNameSchema,
} from '../validation'
import PermissionCheckboxes from './PermissionCheckboxes'

export default function RoleEditor({ canAssignPermissions, onClose, role }: RoleEditorProps) {
    const { state } = useRoleEditorLogic(role)
    const form = state.form

    return (
        <section className={uiClassNames.management.editorCard} aria-labelledby="role-editor-title">
            <div className={uiClassNames.management.editorHeader}>
                <div>
                    <p className={uiClassNames.themedTechnicalLabel}>
                        {role ? 'Custom role' : 'New policy'}
                    </p>
                    <h2 id="role-editor-title">{role ? `Edit ${role.name}` : 'Create role'}</h2>
                </div>
                <button type="button" className={uiClassNames.button.quiet} onClick={onClose}>
                    Close
                </button>
            </div>
            <form
                className={`${uiClassNames.form.stack} ${uiClassNames.form.grid}`}
                noValidate
                onSubmit={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    void form.handleSubmit()
                }}
            >
                <form.Field
                    name="key"
                    validators={{
                        onBlur: ({ value }) => getValidationMessage(roleKeySchema, value),
                    }}
                >
                    {(field) => (
                        <div className={uiClassNames.form.field}>
                            <label
                                className={uiClassNames.form.label}
                                htmlFor={`role-${field.name}`}
                            >
                                Key
                            </label>
                            <input
                                className={uiClassNames.form.control}
                                id={`role-${field.name}`}
                                name={field.name}
                                maxLength={100}
                                value={field.state.value}
                                disabled={role !== null}
                                onBlur={field.handleBlur}
                                onChange={(event) => field.handleChange(event.target.value)}
                                aria-describedby={`role-${field.name}-hint role-${field.name}-error`}
                            />
                            <p id={`role-${field.name}-hint`} className={uiClassNames.form.hint}>
                                Stable lowercase identifier, for example operations.readonly.
                            </p>
                            <FieldError
                                id={`role-${field.name}-error`}
                                errors={field.state.meta.errors}
                            />
                        </div>
                    )}
                </form.Field>
                <form.Field
                    name="name"
                    validators={{
                        onBlur: ({ value }) => getValidationMessage(roleNameSchema, value),
                    }}
                >
                    {(field) => (
                        <div className={uiClassNames.form.field}>
                            <label
                                className={uiClassNames.form.label}
                                htmlFor={`role-${field.name}`}
                            >
                                Name
                            </label>
                            <input
                                className={uiClassNames.form.control}
                                id={`role-${field.name}`}
                                name={field.name}
                                maxLength={100}
                                value={field.state.value}
                                onBlur={field.handleBlur}
                                onChange={(event) => field.handleChange(event.target.value)}
                                aria-describedby={`role-${field.name}-error`}
                            />
                            <FieldError
                                id={`role-${field.name}-error`}
                                errors={field.state.meta.errors}
                            />
                        </div>
                    )}
                </form.Field>
                <form.Field
                    name="description"
                    validators={{
                        onBlur: ({ value }) => getValidationMessage(roleDescriptionSchema, value),
                    }}
                >
                    {(field) => (
                        <div className={`${uiClassNames.form.field} ${uiClassNames.form.wide}`}>
                            <label
                                className={uiClassNames.form.label}
                                htmlFor={`role-${field.name}`}
                            >
                                Description
                            </label>
                            <textarea
                                className={uiClassNames.form.textarea}
                                id={`role-${field.name}`}
                                name={field.name}
                                maxLength={500}
                                value={field.state.value}
                                onBlur={field.handleBlur}
                                onChange={(event) => field.handleChange(event.target.value)}
                                aria-describedby={`role-${field.name}-error`}
                            />
                            <FieldError
                                id={`role-${field.name}-error`}
                                errors={field.state.meta.errors}
                            />
                        </div>
                    )}
                </form.Field>
                <form.Field
                    name="permissionKeys"
                    mode="array"
                    validators={{
                        onChange: ({ value }) => getValidationMessage(permissionKeysSchema, value),
                    }}
                >
                    {(field) => (
                        <PermissionCheckboxes field={field} disabled={!canAssignPermissions} />
                    )}
                </form.Field>
                <div className={uiClassNames.form.wide}>
                    {state.result ? (
                        <FormMessage tone={state.result.success ? 'success' : 'error'}>
                            {state.result.message}
                        </FormMessage>
                    ) : null}
                    {state.isError ? (
                        <FormMessage tone="error">The role could not be saved.</FormMessage>
                    ) : null}
                </div>
                <form.Subscribe
                    selector={(formState) => [formState.canSubmit, formState.isSubmitting] as const}
                >
                    {([canSubmit, isSubmitting]) => (
                        <button
                            type="submit"
                            className={`${uiClassNames.button.primary} ${uiClassNames.form.wide}`}
                            disabled={!canSubmit || isSubmitting || state.isPending}
                        >
                            {isSubmitting || state.isPending
                                ? 'Saving role…'
                                : role
                                  ? 'Save role'
                                  : 'Create role'}
                        </button>
                    )}
                </form.Subscribe>
            </form>
        </section>
    )
}
