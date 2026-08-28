import {
    displayNameSchema,
    emailSchema,
    getValidationMessage,
} from '../../../Auth/Shared/validation'
import FieldError from '../../../../shared/Forms/FieldError'
import FormMessage from '../../../../shared/Forms/FormMessage'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import useEditUserLogic from '../Hooks/useEditUserLogic'
import type { EditUserPanelProps } from '../Types/user-management-component-props.types'
import { roleKeysSchema } from '../validation'
import RoleCheckboxes from './RoleCheckboxes'

export default function EditUserPanel({
    canAssignRoles,
    onClose,
    roles,
    user,
}: EditUserPanelProps) {
    const { state } = useEditUserLogic(user)
    const form = state.form

    return (
        <section className={uiClassNames.management.editorCard} aria-labelledby="edit-user-title">
            <div className={uiClassNames.management.editorHeader}>
                <div>
                    <p className={uiClassNames.themedTechnicalLabel}>User record</p>
                    <h2 id="edit-user-title">Edit {user.displayName}</h2>
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
                    name="displayName"
                    validators={{
                        onBlur: ({ value }) => getValidationMessage(displayNameSchema, value),
                    }}
                >
                    {(field) => (
                        <div className={uiClassNames.form.field}>
                            <label
                                className={uiClassNames.form.label}
                                htmlFor={`edit-${field.name}`}
                            >
                                Display name
                            </label>
                            <input
                                className={uiClassNames.form.control}
                                id={`edit-${field.name}`}
                                name={field.name}
                                maxLength={100}
                                value={field.state.value}
                                onBlur={field.handleBlur}
                                onChange={(event) => field.handleChange(event.target.value)}
                                aria-describedby={`edit-${field.name}-error`}
                            />
                            <FieldError
                                id={`edit-${field.name}-error`}
                                errors={field.state.meta.errors}
                            />
                        </div>
                    )}
                </form.Field>
                <form.Field
                    name="email"
                    validators={{ onBlur: ({ value }) => getValidationMessage(emailSchema, value) }}
                >
                    {(field) => (
                        <div className={uiClassNames.form.field}>
                            <label
                                className={uiClassNames.form.label}
                                htmlFor={`edit-${field.name}`}
                            >
                                Email address
                            </label>
                            <input
                                className={uiClassNames.form.control}
                                id={`edit-${field.name}`}
                                name={field.name}
                                type="email"
                                inputMode="email"
                                maxLength={254}
                                value={field.state.value}
                                onBlur={field.handleBlur}
                                onChange={(event) => field.handleChange(event.target.value)}
                                aria-describedby={`edit-${field.name}-error`}
                            />
                            <FieldError
                                id={`edit-${field.name}-error`}
                                errors={field.state.meta.errors}
                            />
                        </div>
                    )}
                </form.Field>
                <form.Field
                    name="roleKeys"
                    mode="array"
                    validators={{
                        onChange: ({ value }) => getValidationMessage(roleKeysSchema, value),
                    }}
                >
                    {(field) => (
                        <RoleCheckboxes field={field} roles={roles} disabled={!canAssignRoles} />
                    )}
                </form.Field>
                <div className={uiClassNames.form.wide}>
                    {state.result ? (
                        <FormMessage tone={state.result.success ? 'success' : 'error'}>
                            {state.result.message}
                        </FormMessage>
                    ) : null}
                    {state.isError ? (
                        <FormMessage tone="error">The user could not be updated.</FormMessage>
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
                            {isSubmitting || state.isPending ? 'Saving user…' : 'Save user'}
                        </button>
                    )}
                </form.Subscribe>
            </form>
        </section>
    )
}
