import FieldError from '../../../../shared/Forms/FieldError'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import {
    getAvailablePermissionGroups,
    getNextSelectedPermissionKeys,
    getPermissionCheckboxInputId,
} from '../Helpers/permissionCheckboxes'
import type { PermissionCheckboxesProps } from '../Types/role-management-component-props.types'

export default function PermissionCheckboxes({
    availablePermissionKeys,
    disabled,
    field,
}: PermissionCheckboxesProps) {
    const permissionGroups = getAvailablePermissionGroups(availablePermissionKeys)

    return (
        <fieldset className={uiClassNames.permission.fieldset} disabled={disabled}>
            <legend>Permissions</legend>
            <div className="grid gap-3 shell:grid-cols-2">
                {permissionGroups.map((group) => (
                    <section
                        key={group.prefix}
                        aria-labelledby={`${field.name}-${group.prefix}-title`}
                        className="rounded-xl border border-border bg-surface-subtle p-3"
                    >
                        <h3
                            id={`${field.name}-${group.prefix}-title`}
                            className="mb-2 text-sm font-extrabold text-ink-soft"
                        >
                            {group.label}
                        </h3>
                        <div className={uiClassNames.permission.options}>
                            {group.permissions.map((permission) => {
                                const checked = field.state.value.includes(permission.key)
                                const inputId = getPermissionCheckboxInputId(
                                    field.name,
                                    permission.key,
                                )

                                return (
                                    <label
                                        className={uiClassNames.permission.option}
                                        key={permission.key}
                                        htmlFor={inputId}
                                        aria-label={`Toggle ${permission.name} permission`}
                                    >
                                        <input
                                            className={uiClassNames.permission.checkbox}
                                            id={inputId}
                                            type="checkbox"
                                            name={field.name}
                                            value={permission.key}
                                            checked={checked}
                                            onChange={() =>
                                                field.handleChange(
                                                    getNextSelectedPermissionKeys(
                                                        field.state.value,
                                                        permission.key,
                                                    ),
                                                )
                                            }
                                        />
                                        <span className={uiClassNames.permission.copy}>
                                            <strong className={uiClassNames.permission.title}>
                                                {permission.name}
                                            </strong>
                                            <small className={uiClassNames.permission.description}>
                                                {permission.key}
                                            </small>
                                        </span>
                                    </label>
                                )
                            })}
                        </div>
                    </section>
                ))}
            </div>
            <FieldError id={`${field.name}-error`} errors={field.state.meta.errors} />
        </fieldset>
    )
}
