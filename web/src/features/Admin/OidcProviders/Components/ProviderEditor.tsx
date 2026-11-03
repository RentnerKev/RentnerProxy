import { TextInput, PasswordInput, Textarea, CheckboxInput } from '@rentnerkev/inputs'
import { CustomSelect } from '@rentnerkev/select/select'
import { Plus, Trash2 } from 'lucide-react'
import { createOidcProviderId } from '@/lib/Auth/Oidc/providerId.ts'
import { Modal } from '@/shared/Modal/index.tsx'
import { ModalActionButton, ModalCancelButton } from '@/shared/Modal/Components/ModalActions.tsx'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { OidcProvidersLogicResult } from '../Types/oidc-providers.types.ts'
import AccountPolicyEditor from './AccountPolicyEditor.tsx'

/** Edits endpoint trust and explicit subject-to-local-user bindings in one provider draft. */
export default function ProviderEditor({ state, handler, form }: OidcProvidersLogicResult) {
    const { t } = useTranslationStore()
    return (
        <Modal
            open={state.editorOpen}
            onOpenChange={(open) => {
                if (!open) handler.handleClose()
            }}
            title={t(state.editing ? 'oidc.edit' : 'oidc.add')}
            description={null}
            size="lg"
            closeDisabled={state.isPending}
            footer={
                <>
                    <ModalCancelButton disabled={state.isPending} onClick={handler.handleClose} />
                    <ModalActionButton
                        type="submit"
                        form="oidc-provider-form"
                        disabled={state.isPending || state.conflict}
                    >
                        {t('common.save')}
                    </ModalActionButton>
                </>
            }
        >
            <form
                id="oidc-provider-form"
                className="grid gap-4"
                noValidate
                onSubmit={(event) => {
                    event.preventDefault()
                    void form.handleSubmit()
                }}
            >
                {state.conflict ? (
                    <button
                        type="button"
                        className={buttonClassName('secondary', 'justify-self-start')}
                        onClick={() => {
                            void handler.handleRefresh()
                        }}
                    >
                        {t('oidc.refreshConflict')}
                    </button>
                ) : null}
                {(['name', 'issuer', 'clientId'] as const).map((name) => (
                    <form.Field key={name} name={name}>
                        {(field) => (
                            <label className="grid gap-2" htmlFor={`oidc-${name}`}>
                                <span>{t(`oidc.fields.${name}`)}</span>
                                <TextInput
                                    id={`oidc-${name}`}
                                    placeholder={t(`oidc.placeholders.${name}`)}
                                    value={field.state.value}
                                    onValueChange={field.handleChange}
                                    maxLength={
                                        name === 'name' ? 100 : name === 'clientId' ? 255 : 2048
                                    }
                                    autoComplete="off"
                                    disabled={state.isPending}
                                />
                            </label>
                        )}
                    </form.Field>
                ))}
                <form.Field name="clientSecret">
                    {(field) => (
                        <label className="grid gap-2" htmlFor="oidc-client-secret">
                            <span>{t('oidc.fields.clientSecret')}</span>
                            <PasswordInput
                                id="oidc-client-secret"
                                placeholder={t('oidc.placeholders.clientSecret')}
                                value={field.state.value}
                                onValueChange={field.handleChange}
                                maxLength={2048}
                                autoComplete="new-password"
                                disabled={state.isPending}
                                aria-describedby="oidc-secret-hint"
                            />
                            <span id="oidc-secret-hint" className="text-sm text-muted">
                                {t('oidc.secretHint')}
                            </span>
                        </label>
                    )}
                </form.Field>
                <form.Field name="enabled">
                    {(field) => (
                        <label className="flex items-center gap-2">
                            <CheckboxInput
                                id="oidc-enabled"
                                checked={field.state.value}
                                onChange={(event) => field.handleChange(event.target.checked)}
                                disabled={state.isPending}
                            />
                            {t('oidc.enabled')}
                        </label>
                    )}
                </form.Field>
                <form.Field name="tokenEndpointAuthMethod">
                    {(field) => (
                        <label className="grid gap-2" htmlFor="oidc-auth-method">
                            <span>{t('oidc.fields.authMethod')}</span>
                            <CustomSelect
                                id="oidc-auth-method"
                                aria-label={t('oidc.fields.authMethod')}
                                value={field.state.value}
                                onValueChange={(value) => {
                                    if (
                                        value === 'client_secret_basic' ||
                                        value === 'client_secret_post'
                                    )
                                        field.handleChange(value)
                                }}
                                options={[
                                    { value: 'client_secret_basic', label: t('oidc.basic') },
                                    { value: 'client_secret_post', label: t('oidc.post') },
                                ]}
                                disabled={state.isPending}
                            />
                        </label>
                    )}
                </form.Field>
                <details>
                    <summary className="cursor-pointer font-bold">{t('oidc.advanced')}</summary>
                    <p className="text-sm text-muted">{t('oidc.trustHint')}</p>
                    <div className="grid gap-4">
                        {(['endpointOrigins', 'privateCidrs'] as const).map((name) => (
                            <form.Field key={name} name={name}>
                                {(field) => (
                                    <label className="grid gap-2" htmlFor={`oidc-${name}`}>
                                        <span>{t(`oidc.fields.${name}`)}</span>
                                        <Textarea
                                            id={`oidc-${name}`}
                                            placeholder={t(`oidc.placeholders.${name}`)}
                                            value={field.state.value}
                                            onValueChange={field.handleChange}
                                            disabled={state.isPending}
                                        />
                                    </label>
                                )}
                            </form.Field>
                        ))}
                    </div>
                </details>
                <AccountPolicyEditor form={form} state={state} handler={handler} />
                <fieldset className="grid min-w-0 gap-3">
                    <legend className="font-bold">{t('oidc.bindings')}</legend>
                    <p className="text-sm text-muted">{t('oidc.bindingsHint')}</p>
                    <form.Field name="bindings" mode="array">
                        {(field) => (
                            <>
                                {field.state.value.map((binding, index) => (
                                    <div
                                        key={binding.rowId}
                                        className="grid gap-2 rounded-xl border border-border p-3"
                                    >
                                        <label
                                            className="grid gap-2"
                                            htmlFor={`oidc-subject-${index}`}
                                        >
                                            <span>{t('oidc.subject')}</span>
                                            <TextInput
                                                id={`oidc-subject-${index}`}
                                                placeholder={t('oidc.placeholders.subject')}
                                                value={binding.subject}
                                                maxLength={255}
                                                disabled={
                                                    state.isPending ||
                                                    Boolean(
                                                        state.editing?.bindings.some(
                                                            (saved) =>
                                                                saved.subject === binding.subject,
                                                        ),
                                                    )
                                                }
                                                onValueChange={(value) =>
                                                    field.replaceValue(index, {
                                                        ...binding,
                                                        subject: value,
                                                    })
                                                }
                                                autoComplete="off"
                                            />
                                        </label>
                                        <label
                                            className="grid gap-2"
                                            htmlFor={`oidc-user-${index}`}
                                        >
                                            <span>{t('oidc.localUser')}</span>
                                            <CustomSelect
                                                id={`oidc-user-${index}`}
                                                aria-label={t('oidc.localUser')}
                                                value={binding.userId}
                                                options={state.userOptions.filter(
                                                    (option) =>
                                                        !option.disabled ||
                                                        option.value === binding.userId,
                                                )}
                                                onValueChange={(value) =>
                                                    field.replaceValue(index, {
                                                        ...binding,
                                                        userId: value ?? '',
                                                    })
                                                }
                                                disabled={
                                                    state.isPending ||
                                                    binding.roleSource === 'provider'
                                                }
                                            />
                                        </label>
                                        {binding.roleSource === 'provider' ? (
                                            <p className="text-sm text-muted">
                                                {t('oidc.managedBinding')}
                                            </p>
                                        ) : null}
                                        <button
                                            type="button"
                                            className={buttonClassName(
                                                'danger',
                                                'justify-self-start',
                                            )}
                                            disabled={state.isPending}
                                            onClick={() => field.removeValue(index)}
                                        >
                                            <Trash2 className="size-4" aria-hidden="true" />
                                            {t('oidc.removeBinding')}
                                        </button>
                                    </div>
                                ))}
                                <button
                                    type="button"
                                    className={buttonClassName('secondary', 'justify-self-start')}
                                    disabled={state.isPending || field.state.value.length >= 128}
                                    onClick={() =>
                                        field.pushValue({
                                            rowId: createOidcProviderId(),
                                            subject: '',
                                            userId: '',
                                        })
                                    }
                                >
                                    <Plus className="size-4" aria-hidden="true" />
                                    {t('oidc.addBinding')}
                                </button>
                            </>
                        )}
                    </form.Field>
                </fieldset>
            </form>
        </Modal>
    )
}
