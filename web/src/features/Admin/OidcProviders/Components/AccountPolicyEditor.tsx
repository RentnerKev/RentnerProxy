import { CheckboxInput, TextInput } from '@rentnerkev/inputs'
import { CustomSelect } from '@rentnerkev/select/select'
import { OIDC_LIMITS } from '@/config/oidc.config.ts'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { AccountPolicyEditorProps } from '../Types/oidc-providers.types.ts'

/** Makes opt-in account creation and exact group grants visible alongside provider trust. */
export default function AccountPolicyEditor({ form, state, handler }: AccountPolicyEditorProps) {
    const { t } = useTranslationStore()
    return (
        <fieldset className="grid min-w-0 gap-4 rounded-xl border border-border bg-surface-subtle p-4">
            <legend className="px-1 font-bold">{t('oidc.accountPolicy')}</legend>
            <form.Field name="accountPolicy">
                {(field) => (
                    <>
                        <label className="flex items-center gap-2" htmlFor="oidc-provisioning">
                            <CheckboxInput
                                id="oidc-provisioning"
                                checked={field.state.value?.provisioning ?? false}
                                onChange={(event) =>
                                    handler.handlePolicyProvisioning(event.target.checked)
                                }
                                disabled={state.isPending || !state.rolesAvailable}
                                aria-describedby="oidc-provisioning-hint"
                            />
                            {t('oidc.provisioning')}
                        </label>
                        <p id="oidc-provisioning-hint" className="text-sm text-muted">
                            {t('oidc.provisioningHint')}
                        </p>
                        {!state.rolesAvailable ? (
                            <output className="text-sm text-muted">
                                {t('oidc.rolesUnavailable')}
                            </output>
                        ) : null}
                        <label className="grid gap-2" htmlFor="oidc-group-claim">
                            <span>{t('oidc.groupClaim')}</span>
                            <TextInput
                                id="oidc-group-claim"
                                value={field.state.value?.groupClaim ?? 'groups'}
                                onValueChange={handler.handlePolicyGroupClaim}
                                maxLength={128}
                                autoComplete="off"
                                disabled={state.isPending || !state.rolesAvailable}
                                aria-describedby="oidc-group-claim-hint"
                            />
                            <span id="oidc-group-claim-hint" className="text-sm text-muted">
                                {t('oidc.groupClaimHint')}
                            </span>
                        </label>
                        <label className="grid gap-2" htmlFor="oidc-default-roles">
                            <span>{t('oidc.defaultRoles')}</span>
                            <CustomSelect
                                id="oidc-default-roles"
                                aria-label={t('oidc.defaultRoles')}
                                multiple
                                clearable
                                value={field.state.value?.defaultRoleKeys ?? []}
                                onValueChange={handler.handlePolicyDefaultRoles}
                                options={state.roleOptions}
                                maxSelection={OIDC_LIMITS.roleKeys}
                                disabled={state.isPending || !state.rolesAvailable}
                            />
                        </label>
                        <div className="grid min-w-0 gap-3">
                            <h3 className="font-bold">{t('oidc.groupMappings')}</h3>
                            {field.state.value?.groupRoleMappings.map((mapping, index) => (
                                <div
                                    key={mapping.rowId}
                                    className="grid min-w-0 gap-3 rounded-xl border border-border bg-surface-raised p-3"
                                >
                                    <label className="grid gap-2" htmlFor={`oidc-group-${index}`}>
                                        <span>{t('oidc.group')}</span>
                                        <TextInput
                                            id={`oidc-group-${index}`}
                                            value={mapping.group}
                                            onValueChange={(value) =>
                                                handler.handleMappingGroup(mapping.rowId, value)
                                            }
                                            maxLength={OIDC_LIMITS.groupLength}
                                            autoComplete="off"
                                            disabled={state.isPending || !state.rolesAvailable}
                                        />
                                    </label>
                                    <label
                                        className="grid gap-2"
                                        htmlFor={`oidc-group-roles-${index}`}
                                    >
                                        <span>{t('oidc.mappedRoles')}</span>
                                        <CustomSelect
                                            id={`oidc-group-roles-${index}`}
                                            aria-label={t('oidc.mappedRoles')}
                                            multiple
                                            clearable
                                            value={mapping.roleKeys}
                                            onValueChange={(value) =>
                                                handler.handleMappingRoles(mapping.rowId, value)
                                            }
                                            options={state.roleOptions}
                                            maxSelection={OIDC_LIMITS.roleKeys}
                                            disabled={state.isPending || !state.rolesAvailable}
                                        />
                                    </label>
                                    <button
                                        id={`oidc-remove-mapping-${index}`}
                                        type="button"
                                        className={buttonClassName('secondary')}
                                        onClick={() => handler.handleRemoveMapping(mapping.rowId)}
                                        disabled={state.isPending || !state.rolesAvailable}
                                    >
                                        {t('oidc.removeMapping')}
                                    </button>
                                </div>
                            ))}
                            <button
                                id="oidc-add-mapping"
                                type="button"
                                className={buttonClassName('secondary')}
                                onClick={handler.handleAddMapping}
                                disabled={
                                    state.isPending ||
                                    !state.rolesAvailable ||
                                    (field.state.value?.groupRoleMappings.length ?? 0) >=
                                        OIDC_LIMITS.groupMappings
                                }
                            >
                                {t('oidc.addMapping')}
                            </button>
                        </div>
                        <p className="text-sm text-muted">{t('oidc.rolePolicyHint')}</p>
                    </>
                )}
            </form.Field>
        </fieldset>
    )
}
