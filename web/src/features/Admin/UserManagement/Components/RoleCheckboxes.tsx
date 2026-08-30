import FieldError from '../../../../shared/Forms/FieldError'
import useTranslationStore from '../../../../language/useTranslationStore'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import { getNextSelectedRoleKeys, getRoleCheckboxInputId } from '../Helpers/roleCheckboxes'
import type { RoleCheckboxesProps } from '../Types/user-management-component-props.types'

export default function RoleCheckboxes({ disabled, field, roles }: RoleCheckboxesProps) {
    const { t } = useTranslationStore()
    return (
        <fieldset className={uiClassNames.permission.fieldset} disabled={disabled}>
            <legend>{t('admin.users.form.roles')}</legend>
            <div className={uiClassNames.permission.options}>
                {roles.map((role) => {
                    const checked = field.state.value.includes(role.key)
                    const inputId = getRoleCheckboxInputId(field.name, role.id)

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
                                aria-label={t('admin.users.roles.assign', {
                                    role: role.isSystem
                                        ? t(`systemRoles.${role.key}.name`)
                                        : role.name,
                                })}
                                checked={checked}
                                onChange={() =>
                                    field.handleChange(
                                        getNextSelectedRoleKeys(field.state.value, role.key),
                                    )
                                }
                            />
                            <span className={uiClassNames.permission.copy}>
                                <strong className={uiClassNames.permission.title}>
                                    {role.isSystem ? t(`systemRoles.${role.key}.name`) : role.name}
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
