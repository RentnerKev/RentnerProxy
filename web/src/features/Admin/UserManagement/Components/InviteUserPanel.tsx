import {
    displayNameSchema,
    emailSchema,
    getValidationMessage,
} from '../../../Auth/Shared/validation'
import FieldError from '../../../../shared/Forms/FieldError'
import FormMessage from '../../../../shared/Forms/FormMessage'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import useInviteUserLogic from '../Hooks/useInviteUserLogic'
import type { InviteUserPanelProps } from '../Types/user-management-component-props.types'
import { roleKeysSchema } from '../validation'
import RoleCheckboxes from './RoleCheckboxes'

export default function InviteUserPanel({ canAssignRoles, onClose, roles }: InviteUserPanelProps) {
    const { state } = useInviteUserLogic()
    const form = state.form

    return (
        <section className={uiClassNames.management.editorCard} aria-labelledby="invite-user-title">
            <div className={uiClassNames.management.editorHeader}>
                <div>
                    <p className={uiClassNames.themedTechnicalLabel}>New access</p>
                    <h2 id="invite-user-title">Invite user</h2>
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
                        onBlur: ({ value }) =>
                            value ? getValidationMessage(displayNameSchema, value) : undefined,
                    }}
                >
                    {(field) => (
                        <div className={uiClassNames.form.field}>
                            <label
                                className={uiClassNames.form.label}
                                htmlFor={`invite-${field.name}`}
                            >
                                Display name (optional)
                            </label>
                            <input
                                className={uiClassNames.form.control}
                                id={`invite-${field.name}`}
                                name={field.name}
                                autoComplete="off"
                                maxLength={100}
                                value={field.state.value}
                                onBlur={field.handleBlur}
                                onChange={(event) => field.handleChange(event.target.value)}
                                aria-describedby={`invite-${field.name}-error`}
                            />
                            <FieldError
                                id={`invite-${field.name}-error`}
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
                                htmlFor={`invite-${field.name}`}
                            >
                                Email address
                            </label>
                            <input
                                className={uiClassNames.form.control}
                                id={`invite-${field.name}`}
                                name={field.name}
                                type="email"
                                inputMode="email"
                                autoComplete="off"
                                maxLength={254}
                                value={field.state.value}
                                onBlur={field.handleBlur}
                                onChange={(event) => field.handleChange(event.target.value)}
                                aria-describedby={`invite-${field.name}-error`}
                            />
                            <FieldError
                                id={`invite-${field.name}-error`}
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
                        <FormMessage tone="error">The user could not be invited.</FormMessage>
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
                                ? 'Sending invitation…'
                                : 'Create and invite'}
                        </button>
                    )}
                </form.Subscribe>
            </form>
        </section>
    )
}
