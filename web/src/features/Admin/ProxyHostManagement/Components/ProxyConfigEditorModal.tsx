import { NumberInput } from '@rentnerkev/inputs'
import { RotateCcw, Save } from 'lucide-react'

import useTranslationStore, { type Translate } from '../../../../language/useTranslationStore'
import { Modal } from '../../../../shared/Modal'
import { ConfirmDialog } from '../../../../shared/Modal/Components/ConfirmDialog'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import type { ProxyHostSummary } from '../../../../shared/Types/proxy-hosts.types'
import type { ProxyHttpSettings } from '../../../../shared/Types/proxy-runtime.types'
import { formatProxyHostForward } from '../Helpers/proxyHostTableCells'
import CaddyConfigCodeBlock from './CaddyConfigCodeBlock'
import useProxyConfigEditorLogic from '../Hooks/useProxyConfigEditorLogic'
import type { ProxyConfigEditorModalProps } from '../Types/proxy-config-editor.types'

const FIELDS = [
    ['clientMaxBodySizeBytes', 'fieldClientMaxBodySizeBytes', 1024, 1073741824, 'bytes'],
    ['proxyConnectTimeoutSeconds', 'fieldProxyConnectTimeoutSeconds', 1, 60, 'seconds'],
    ['proxyReadTimeoutSeconds', 'fieldProxyReadTimeoutSeconds', 1, 3600, 'seconds'],
    ['proxySendTimeoutSeconds', 'fieldProxySendTimeoutSeconds', 1, 3600, 'seconds'],
] as const

const statusBadgeClassName =
    'inline-flex rounded-full px-2.5 py-1 text-[0.68rem] font-extrabold data-[status=enabled]:bg-success-bg data-[status=enabled]:text-success-text data-[status=disabled]:bg-danger-bg data-[status=disabled]:text-danger-text'

const sourceBadgeClassName =
    'inline-flex shrink-0 rounded-full px-2.5 py-1 text-[0.68rem] font-extrabold data-[source=inherited]:bg-neutral data-[source=inherited]:text-muted data-[source=override]:bg-info-bg data-[source=override]:text-info-text'

function getInboundTransport(host: ProxyHostSummary, t: Translate): string {
    if (!host.certificateId) return t('admin.proxyHosts.config.httpOnly')
    return t(
        host.forceHttps
            ? 'admin.proxyHosts.config.httpsRedirect'
            : 'admin.proxyHosts.config.httpAndHttps',
    )
}

function getUpstreamTransport(host: ProxyHostSummary, t: Translate): string {
    if (host.forwardScheme === 'http') return t('admin.proxyHosts.config.upstreamHttp')
    if (!host.verifyUpstreamTls) return t('admin.proxyHosts.upstreamTls.verificationDisabled')
    return t(
        host.trustedCaId
            ? 'admin.proxyHosts.config.upstreamTlsCustomTrust'
            : 'admin.proxyHosts.config.upstreamTlsSystemTrust',
    )
}

function HostConfigurationOverview({
    activeAvailable,
    enabled,
    host,
    t,
}: {
    readonly activeAvailable: boolean
    readonly enabled: boolean
    readonly host: ProxyHostSummary
    readonly t: Translate
}) {
    const status = enabled ? 'enabled' : 'disabled'
    const activeState = !enabled ? 'saved' : activeAvailable ? 'active' : 'unavailable'
    const activeStateClassName =
        activeState === 'active'
            ? 'bg-success-bg text-success-text'
            : activeState === 'saved'
              ? 'bg-info-bg text-info-text'
              : 'bg-neutral text-muted'
    return (
        <section
            className="grid gap-3 rounded-2xl border border-border bg-surface-subtle p-4"
            aria-labelledby="proxy-host-config-overview"
        >
            <h3
                id="proxy-host-config-overview"
                className="m-0 text-sm font-extrabold text-ink-soft"
            >
                {t('admin.proxyHosts.config.hostOverview')}
            </h3>
            <dl className="m-0 grid min-w-0 gap-3 sm:grid-cols-2">
                <div className="grid min-w-0 gap-1">
                    <dt className={uiClassNames.technicalLabel}>
                        {t('admin.proxyHosts.columns.domains')}
                    </dt>
                    <dd className="m-0">
                        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                            {host.domains.map((domain) => (
                                <li
                                    key={domain}
                                    className="max-w-full wrap-anywhere rounded-full border border-brand-600/20 bg-surface-raised px-2.5 py-1 font-mono text-xs text-ink-soft"
                                >
                                    {domain}
                                </li>
                            ))}
                        </ul>
                    </dd>
                </div>
                <div className="grid min-w-0 gap-1">
                    <dt className={uiClassNames.technicalLabel}>
                        {t('admin.proxyHosts.columns.forward')}
                    </dt>
                    <dd className="m-0 wrap-anywhere font-mono text-xs text-ink-soft">
                        {formatProxyHostForward(
                            host.forwardScheme,
                            host.forwardHost,
                            host.forwardPort,
                        )}
                    </dd>
                </div>
                <div className="grid min-w-0 gap-1">
                    <dt className={uiClassNames.technicalLabel}>
                        {t('admin.proxyHosts.config.clientTransport')}
                    </dt>
                    <dd className="m-0 text-sm font-semibold text-ink-soft">
                        {getInboundTransport(host, t)}
                    </dd>
                </div>
                <div className="grid min-w-0 gap-1">
                    <dt className={uiClassNames.technicalLabel}>
                        {t('admin.proxyHosts.upstreamTls.title')}
                    </dt>
                    <dd className="m-0 grid min-w-0 gap-0.5 text-sm font-semibold text-ink-soft">
                        <span>{getUpstreamTransport(host, t)}</span>
                        {host.forwardScheme === 'https' && host.upstreamTlsServerName ? (
                            <span className="wrap-anywhere font-mono text-xs font-normal text-muted">
                                {t('admin.proxyHosts.upstreamTls.serverName')} ·{' '}
                                {host.upstreamTlsServerName}
                            </span>
                        ) : null}
                    </dd>
                </div>
                <div className="grid min-w-0 gap-1">
                    <dt className={uiClassNames.technicalLabel}>
                        {t('admin.proxyHosts.columns.status')}
                    </dt>
                    <dd className="m-0">
                        <span className={statusBadgeClassName} data-status={status}>
                            {t('admin.proxyHosts.status.' + status)}
                        </span>
                    </dd>
                </div>
                <div className="grid min-w-0 gap-1">
                    <dt className={uiClassNames.technicalLabel}>
                        {t('admin.proxyHosts.config.currentConfiguration')}
                    </dt>
                    <dd className="m-0">
                        <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-[0.68rem] font-extrabold ${activeStateClassName}`}
                            data-config-state={activeState}
                        >
                            {t(`admin.proxyHosts.config.currentConfigurationStates.${activeState}`)}
                        </span>
                    </dd>
                </div>
            </dl>
        </section>
    )
}

function HostSettingField({
    field,
    inheritedSettings,
    settings,
    busy,
    canEdit,
    setSetting,
    t,
}: {
    readonly field: (typeof FIELDS)[number]
    readonly inheritedSettings: ProxyHttpSettings
    readonly settings: ProxyHttpSettings
    readonly busy: boolean
    readonly canEdit: boolean
    readonly setSetting: (key: keyof ProxyHttpSettings, value: number | undefined) => void
    readonly t: Translate
}) {
    const [key, labelKey, min, max, unitKey] = field
    const value = settings[key]
    const source = value === undefined ? 'inherited' : 'override'
    const effectiveValue = value ?? inheritedSettings[key]
    const inputId = `proxy-host-setting-${key}`
    const helpId = `${inputId}-effective`
    return (
        <div
            className="grid min-w-0 gap-2 rounded-xl border border-border bg-surface-subtle p-3"
            data-setting={key}
            data-setting-source={source}
        >
            <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor={inputId} className="text-sm font-bold text-ink-soft">
                    {t(`admin.proxyHosts.config.${labelKey}`)}
                </label>
                <span className={sourceBadgeClassName} data-source={source}>
                    {t(`admin.proxyHosts.config.sources.${source}`)}
                </span>
            </div>
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                <NumberInput
                    id={inputId}
                    type="number"
                    min={min}
                    max={max}
                    value={value === undefined ? '' : String(value)}
                    onChange={(event) =>
                        setSetting(
                            key,
                            event.target.value === '' ? undefined : Number(event.target.value),
                        )
                    }
                    disabled={!canEdit || busy}
                    aria-describedby={helpId}
                />
                <span className="text-xs text-muted">
                    {t(`admin.proxyHosts.config.${unitKey}`)}
                </span>
            </div>
            <p id={helpId} className={uiClassNames.form.hint} aria-live="polite">
                {effectiveValue === undefined
                    ? t('admin.proxyHosts.config.effectiveCaddyDefault')
                    : t('admin.proxyHosts.config.effectiveValue', {
                          value: effectiveValue,
                          unit: t(`admin.proxyHosts.config.${unitKey}`),
                      })}
            </p>
        </div>
    )
}

/** Renders the per-host proxy settings editor and active Caddy configuration. */
export default function ProxyConfigEditorModal(props: ProxyConfigEditorModalProps) {
    const { t } = useTranslationStore()
    const { state, handler } = useProxyConfigEditorLogic(props)
    const busy = state.isRefreshing || state.isSaving || state.isResetting
    const source = state.data?.active?.config
    return (
        <>
            <Modal
                open={props.open}
                onOpenChange={props.onOpenChange}
                title={t('admin.proxyHosts.config.hostTitle', {
                    name: props.proxyHost.domains[0] ?? props.proxyHost.forwardHost,
                })}
                description={t('admin.proxyHosts.config.hostDescription')}
                size="lg"
                closeDisabled={busy || state.isResetConfirmationOpen}
                footer={
                    <>
                        <button
                            type="button"
                            className={uiClassNames.button.secondary}
                            onClick={() => props.onOpenChange(false)}
                            disabled={busy}
                        >
                            {t('common.cancel')}
                        </button>
                        {props.canEdit ? (
                            <>
                                <button
                                    type="button"
                                    className={uiClassNames.button.danger}
                                    onClick={handler.reset}
                                    disabled={busy || !state.data}
                                >
                                    <RotateCcw className="size-4" />
                                    {t('admin.proxyHosts.config.resetButton')}
                                </button>
                                <button
                                    type="button"
                                    className={uiClassNames.button.primary}
                                    onClick={handler.save}
                                    disabled={busy || !state.data}
                                >
                                    <Save className="size-4" />
                                    {t('admin.proxyHosts.config.save')}
                                </button>
                            </>
                        ) : null}
                    </>
                }
            >
                {state.isLoading && !state.data ? (
                    <output className="grid min-h-64 place-items-center text-sm text-muted">
                        {t('admin.proxyHosts.config.loading')}
                    </output>
                ) : !state.data ? (
                    <p role="alert" className="text-danger-text">
                        {t('admin.proxyHosts.config.errors.loadFailed')}
                    </p>
                ) : (
                    <div className="grid gap-4">
                        <HostConfigurationOverview
                            activeAvailable={Boolean(source)}
                            enabled={state.data.enabled}
                            host={props.proxyHost}
                            t={t}
                        />
                        {!state.data.enabled ? (
                            <p className="m-0 rounded-xl border border-border bg-surface-subtle px-3 py-2 text-sm text-muted">
                                {t('admin.proxyHosts.config.disabledHost')}
                            </p>
                        ) : null}
                        {!props.canEdit ? (
                            <p className="m-0 rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm text-muted">
                                {t('admin.proxyHosts.config.readOnly')}
                            </p>
                        ) : null}
                        <div className="flex flex-wrap gap-1">
                            {(['edit', 'active'] as const).map((tab) => (
                                <button
                                    key={tab}
                                    type="button"
                                    className={uiClassNames.button.quiet}
                                    onClick={() => handler.setActiveTab(tab)}
                                    aria-pressed={state.activeTab === tab}
                                    disabled={busy}
                                >
                                    {t(
                                        `admin.proxyHosts.config.${tab === 'edit' ? 'settings' : tab}`,
                                    )}
                                </button>
                            ))}
                        </div>
                        {state.activeTab === 'edit' ? (
                            <fieldset className="grid min-w-0 gap-3">
                                <legend className="text-base font-extrabold text-ink-soft">
                                    {t('admin.proxyHosts.config.settings')}
                                </legend>
                                <p className="m-0 text-sm leading-relaxed text-muted">
                                    {t('admin.proxyHosts.config.inheritsDefaults')}
                                </p>
                                <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                                    {FIELDS.map((field) => (
                                        <HostSettingField
                                            key={field[0]}
                                            field={field}
                                            inheritedSettings={state.data!.inheritedSettings}
                                            settings={state.settings}
                                            busy={busy}
                                            canEdit={props.canEdit}
                                            setSetting={handler.setSetting}
                                            t={t}
                                        />
                                    ))}
                                </div>
                            </fieldset>
                        ) : state.activeTab === 'active' && source ? (
                            <CaddyConfigCodeBlock
                                source={source}
                                ariaLabel={t('admin.proxyHosts.config.active')}
                            />
                        ) : (
                            <p className="m-0 text-sm text-muted">
                                {t('admin.proxyHosts.config.hostActiveUnavailable')}
                            </p>
                        )}
                    </div>
                )}
            </Modal>
            {state.isResetConfirmationOpen ? (
                <ConfirmDialog
                    open
                    onOpenChange={handler.setResetConfirmationOpen}
                    title={t('admin.proxyHosts.config.hostResetTitle')}
                    description={t('admin.proxyHosts.config.hostResetDescription', {
                        name: props.proxyHost.domains[0] ?? props.proxyHost.forwardHost,
                    })}
                    confirmLabel={t('admin.proxyHosts.config.resetConfirm')}
                    pendingLabel={t('admin.proxyHosts.config.resetting')}
                    isPending={state.isResetting}
                    onConfirm={handler.confirmReset}
                />
            ) : null}
        </>
    )
}
