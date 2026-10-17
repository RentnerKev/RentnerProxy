import { CheckboxInput, PasswordInput, TextInput } from '@rentnerkev/inputs'
import {
    MAX_CLOUDFLARE_API_TOKEN_LENGTH,
    MAX_DNS_CONNECTION_NAME_LENGTH,
    MAX_DNS_CONNECTION_ZONES,
} from '@/config/dns-connections.config.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { Modal } from '@/shared/Modal/index.tsx'
import type useDnsConnectionsLogic from '../Hooks/useDnsConnectionsLogic.ts'

export default function DnsConnectionEditor({
    state,
    handler,
    form,
}: ReturnType<typeof useDnsConnectionsLogic>) {
    const { t } = useTranslationStore()
    return (
        <Modal
            open
            onOpenChange={handler.handleEditorOpenChange}
            closeDisabled={state.isPending}
            title={t(
                state.editing
                    ? 'admin.dnsConnections.actions.edit'
                    : 'admin.dnsConnections.actions.add',
            )}
            description={t('admin.dnsConnections.form.description')}
            footer={
                <>
                    <button
                        type="button"
                        disabled={state.isPending}
                        onClick={() => handler.handleEditorOpenChange(false)}
                        className="h-12 rounded-xl border border-danger-border bg-danger-bg px-4 text-sm font-extrabold text-danger-text disabled:opacity-50"
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        type="submit"
                        form={state.formId}
                        disabled={state.isPending || state.isStale}
                        className="h-12 rounded-xl bg-accent px-4 text-sm font-extrabold text-accent-foreground enabled:hover:bg-accent-hover disabled:opacity-50"
                    >
                        {t(state.isPending ? 'common.working' : 'common.save')}
                    </button>
                </>
            }
        >
            <form id={state.formId} onSubmit={handler.handleSubmit} className="grid gap-5">
                <form.Field name="name">
                    {(field) => (
                        <div className="grid gap-2">
                            <label
                                htmlFor={`${state.formId}-name`}
                                className="text-sm font-bold text-ink-soft"
                            >
                                {t('admin.dnsConnections.form.name')}
                            </label>
                            <TextInput
                                id={`${state.formId}-name`}
                                name="name"
                                value={field.state.value}
                                onValueChange={field.handleChange}
                                onBlur={field.handleBlur}
                                maxLength={MAX_DNS_CONNECTION_NAME_LENGTH}
                                disabled={state.isPending}
                                autoComplete="off"
                            />
                        </div>
                    )}
                </form.Field>
                <form.Field name="apiToken">
                    {(field) => (
                        <div className="grid gap-2">
                            <label
                                htmlFor={`${state.formId}-token`}
                                className="text-sm font-bold text-ink-soft"
                            >
                                {t('admin.dnsConnections.form.token')}
                            </label>
                            <PasswordInput
                                id={`${state.formId}-token`}
                                name="apiToken"
                                type="password"
                                value={field.state.value}
                                onValueChange={field.handleChange}
                                onBlur={field.handleBlur}
                                maxLength={MAX_CLOUDFLARE_API_TOKEN_LENGTH}
                                disabled={state.isPending}
                                autoComplete="new-password"
                                showPasswordStrength={false}
                                aria-describedby={`${state.formId}-token-hint`}
                            />
                            <p id={`${state.formId}-token-hint`} className="text-sm text-muted">
                                {t(
                                    state.editing
                                        ? 'admin.dnsConnections.form.replaceHint'
                                        : 'admin.dnsConnections.form.tokenHint',
                                )}
                            </p>
                        </div>
                    )}
                </form.Field>
                <p className="rounded-xl border border-border bg-surface-subtle p-3 text-sm leading-relaxed text-muted">
                    {t('admin.dnsConnections.form.readOnlyHint')}
                </p>
                <button
                    type="button"
                    onClick={handler.handleTest}
                    disabled={state.isPending}
                    className="h-12 rounded-xl border border-border-strong bg-surface-raised px-4 text-sm font-extrabold text-ink-soft enabled:hover:border-accent-border disabled:opacity-50"
                >
                    {t(state.isPending ? 'common.working' : 'admin.dnsConnections.actions.test')}
                </button>
                <form.Field name="zoneIds">
                    {(field) => (
                        <fieldset className="grid gap-3" disabled={state.isPending}>
                            <legend className="mb-2 text-sm font-bold text-ink-soft">
                                {t('admin.dnsConnections.form.zones', {
                                    count: field.state.value.length,
                                    max: MAX_DNS_CONNECTION_ZONES,
                                })}
                            </legend>
                            <p className="text-sm text-muted">
                                {t('admin.dnsConnections.form.zonesHint')}
                            </p>
                            {state.zones.length === 0 ? (
                                <p className="text-sm text-muted">
                                    {t('admin.dnsConnections.form.noZones')}
                                </p>
                            ) : null}
                            {state.zones.map((zone) => (
                                <div
                                    key={zone.id}
                                    className="grid gap-1 rounded-xl border border-border p-3"
                                >
                                    <CheckboxInput
                                        id={`${state.formId}-${zone.id}`}
                                        checked={field.state.value.includes(zone.id)}
                                        onChange={(event) =>
                                            handler.handleZoneChange(zone.id, event.target.checked)
                                        }
                                        disabled={
                                            state.isPending ||
                                            state.lockedZoneIds.has(zone.id) ||
                                            (!field.state.value.includes(zone.id) &&
                                                field.state.value.length >=
                                                    MAX_DNS_CONNECTION_ZONES)
                                        }
                                        aria-label={zone.name}
                                    />
                                    <label
                                        htmlFor={`${state.formId}-${zone.id}`}
                                        className="text-sm font-bold text-ink-soft"
                                    >
                                        {zone.name}
                                    </label>
                                    <span className="break-all font-mono text-xs text-muted">
                                        {zone.id}
                                    </span>
                                    {state.lockedZoneIds.has(zone.id) ? (
                                        <p className="text-sm text-muted">
                                            {t('admin.dnsConnections.form.zoneInUse')}
                                        </p>
                                    ) : null}
                                </div>
                            ))}
                        </fieldset>
                    )}
                </form.Field>
            </form>
        </Modal>
    )
}
