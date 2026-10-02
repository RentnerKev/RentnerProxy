import { CheckboxInput } from '@rentnerkev/inputs'
import FieldError from '@/shared/Forms/FieldError.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import {
    getNextSelectedRoleKeys,
    getRoleCheckboxInputId,
} from '@/lib/Admin/UserManagement/roleCheckboxes.ts'
import type { RoleCheckboxesProps } from '../../../Types/user-management-component-props.types.ts'

export default function RoleCheckboxes({ disabled, field, roles }: RoleCheckboxesProps) {
    const { t } = useTranslationStore()
    return (
        <fieldset
            className="m-0 min-w-0 border-0 p-0 [&_legend]:mb-[0.55rem] [&_legend]:text-[0.82rem] [&_legend]:font-[750] [&_legend]:text-ink-soft"
            disabled={disabled}
        >
            <legend>{t('admin.users.form.roles')}</legend>
            <div className="grid gap-[0.45rem]">
                {roles.map((role) => {
                    const checked = field.state.value.includes(role.key)
                    const inputId = getRoleCheckboxInputId(field.name, role.id)

                    return (
                        <label
                            className="flex cursor-pointer items-start gap-[0.65rem] rounded-[0.7rem] border border-border bg-surface-raised p-[0.65rem]"
                            key={role.id}
                            htmlFor={inputId}
                        >
                            <CheckboxInput
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
                            <span className="grid gap-[0.12rem]">
                                <strong className="text-[0.78rem] text-ink-soft">
                                    {role.isSystem ? t(`systemRoles.${role.key}.name`) : role.name}
                                </strong>
                                <small className="font-mono text-[0.62rem] text-muted">
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
