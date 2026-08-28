import FieldError from '../../../../shared/Forms/FieldError'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import type { RoleCheckboxesProps } from '../Types/user-management-component-props.types'

export default function RoleCheckboxes({ disabled, field, roles }: RoleCheckboxesProps) {
    return (
        <fieldset className={uiClassNames.permission.fieldset} disabled={disabled}>
            <legend>Roles</legend>
            <div className={uiClassNames.permission.options}>
                {roles.map((role) => {
                    const checked = field.state.value.includes(role.key)
                    const inputId = `${field.name}-${role.id}`
                    return (
                        <label
                            className={uiClassNames.permission.option}
                            key={role.id}
                            htmlFor={inputId}
                        >
                            <input
                                className={uiClassNames.permission.checkbox}
                                id={inputId}
                                type="checkbox"
                                name={field.name}
                                value={role.key}
                                aria-label={`Assign ${role.name} role`}
                                checked={checked}
                                onChange={() =>
                                    field.handleChange(
                                        checked
                                            ? field.state.value.filter((key) => key !== role.key)
                                            : [...field.state.value, role.key],
                                    )
                                }
                            />
                            <span className={uiClassNames.permission.copy}>
                                <strong className={uiClassNames.permission.title}>
                                    {role.name}
                                </strong>
                                <small className={uiClassNames.permission.description}>
                                    {role.key}
                                </small>
                            </span>
                        </label>
                    )
                })}
            </div>
            <FieldError id={`${field.name}-error`} errors={field.state.meta.errors} />
        </fieldset>
    )
}
