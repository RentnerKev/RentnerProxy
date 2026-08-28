import { PERMISSION_REGISTRY } from '../../../../config/permissions.config'
import FieldError from '../../../../shared/Forms/FieldError'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import type { PermissionCheckboxesProps } from '../Types/role-management-component-props.types'

export default function PermissionCheckboxes({ disabled, field }: PermissionCheckboxesProps) {
    return (
        <fieldset
            className={`${uiClassNames.permission.fieldset} ${uiClassNames.form.wide}`}
            disabled={disabled}
        >
            <legend>Permissions</legend>
            <div className={`${uiClassNames.permission.options} ${uiClassNames.permission.matrix}`}>
                {PERMISSION_REGISTRY.map((permission) => {
                    const checked = field.state.value.includes(permission.key)
                    const inputId = `${field.name}-${permission.key.replaceAll('.', '-')}`
                    return (
                        <label
                            className={uiClassNames.permission.option}
                            key={permission.key}
                            htmlFor={inputId}
                        >
                            <input
                                className={uiClassNames.permission.checkbox}
                                id={inputId}
                                type="checkbox"
                                name={field.name}
                                value={permission.key}
                                aria-label={`Assign ${permission.name} permission`}
                                checked={checked}
                                onChange={() =>
                                    field.handleChange(
                                        checked
                                            ? field.state.value.filter(
                                                  (key) => key !== permission.key,
                                              )
                                            : [...field.state.value, permission.key],
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
            <FieldError id={`${field.name}-error`} errors={field.state.meta.errors} />
        </fieldset>
    )
}
