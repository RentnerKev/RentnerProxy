import { CheckboxInput } from '@rentnerkev/inputs'
import FieldError from '../../../../shared/Forms/FieldError'
import useTranslationStore from '../../../../language/useTranslationStore'
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
    const { t } = useTranslationStore()
    const permissionGroups = getAvailablePermissionGroups(availablePermissionKeys)

    return (
        <fieldset
            className="m-0 min-w-0 border-0 p-0 [&_legend]:mb-[0.55rem] [&_legend]:text-[0.82rem] [&_legend]:font-[750] [&_legend]:text-ink-soft"
            disabled={disabled}
        >
            <legend>{t('admin.roles.form.permissions')}</legend>
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
                            {t(group.label)}
                        </h3>
                        <div className="grid gap-[0.45rem]">
                            {group.permissions.map((permission) => {
                                const checked = field.state.value.includes(permission.key)
                                const inputId = getPermissionCheckboxInputId(
                                    field.name,
                                    permission.key,
                                )

                                return (
                                    <label
                                        className="flex cursor-pointer items-start gap-[0.65rem] rounded-[0.7rem] border border-border bg-surface-raised p-[0.65rem]"
                                        key={permission.key}
                                        htmlFor={inputId}
                                        aria-label={t('admin.roles.permissions.toggle', {
                                            permission: t(`permissions.${permission.key}`),
                                        })}
                                    >
                                        <CheckboxInput
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
                                        <span className="grid gap-[0.12rem]">
                                            <strong className="text-[0.78rem] text-ink-soft">
                                                {t(`permissions.${permission.key}`)}
                                            </strong>
                                            <small className="font-mono text-[0.62rem] text-muted">
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
