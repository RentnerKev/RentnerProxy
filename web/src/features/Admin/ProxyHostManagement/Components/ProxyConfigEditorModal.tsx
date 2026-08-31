import { Eye, RefreshCw, RotateCcw, Save } from 'lucide-react'

import useTranslationStore from '../../../../language/useTranslationStore'
import { PROXY_HTTP_SETTINGS } from '../../../../config/proxy-http.config'
import { ConfirmDialog } from '../../../../shared/Modal/Components/ConfirmDialog'
import { Modal } from '../../../../shared/Modal'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import useProxyConfigEditorLogic from '../Hooks/useProxyConfigEditorLogic'
import type {
    ProxyConfigEditorModalProps,
    ProxyConfigEditorState,
    ProxyConfigEditorTab,
} from '../Types/proxy-config-editor.types'
import NginxConfigEditor from './NginxConfigEditor'

const errorClassName =
    'm-0 rounded-xl border border-red-500/30 bg-danger-bg px-3 py-2 text-sm leading-relaxed text-danger-text'
const tabs: ReadonlyArray<{ value: ProxyConfigEditorTab; label: string }> = [
    { value: 'edit', label: 'admin.proxyHosts.config.editTab' },
    { value: 'active', label: 'admin.proxyHosts.config.active' },
    { value: 'defaults', label: 'admin.proxyHosts.config.defaults' },
    { value: 'preview', label: 'admin.proxyHosts.config.preview' },
]

function getEditorError(
    t: ReturnType<typeof useTranslationStore>['t'],
    error: string | null,
    line: number | null,
    fallback: string,
): string | null {
    if (!error) return null
    if (line !== null) return t('admin.proxyHosts.config.invalidLine', { line })
    return t(error, { defaultValue: t(fallback) })
}

function EditorBody({
    canAdvancedConfig,
    canEdit,
    handler,
    state,
}: {
    readonly canAdvancedConfig: boolean
    readonly canEdit: boolean
    readonly handler: ReturnType<typeof useProxyConfigEditorLogic>['handler']
    readonly state: ProxyConfigEditorState
}) {
    const { t } = useTranslationStore()
    const isBusy = state.isSaving || state.isResetting || state.isPreviewing
    const actionError = getEditorError(
        t,
        state.actionError,
        state.actionErrorLine,
        'admin.proxyHosts.config.errors.saveFailed',
    )
    const previewError = getEditorError(
        t,
        state.previewError,
        state.previewErrorLine,
        'admin.proxyHosts.config.errors.previewFailed',
    )

    if (state.isLoading && state.data === undefined) {
        return (
            <output className="grid min-h-64 place-items-center text-sm text-muted">
                {t('admin.proxyHosts.config.loading')}
            </output>
        )
    }
    if (!state.data) {
        return (
            <div className="grid min-h-64 place-items-center content-center gap-3">
                <p className={errorClassName} role="alert">
                    {t('admin.proxyHosts.config.errors.loadFailed')}
                </p>
                <button
                    type="button"
                    className={uiClassNames.button.secondary}
                    onClick={handler.refresh}
                    disabled={state.isRefreshing}
                >
                    <RefreshCw aria-hidden="true" className="size-4" />
                    {t('admin.proxyHosts.config.reload')}
                </button>
            </div>
        )
    }

    const source =
        state.activeTab === 'edit'
            ? state.draft
            : state.activeTab === 'active'
              ? canAdvancedConfig
                  ? state.data.active?.config
                  : null
              : state.activeTab === 'defaults'
                ? state.data.defaults?.config
                : state.preview?.config
    const sourceUnavailable = source === undefined || source === null
    const readOnly = !canEdit || state.activeTab !== 'edit' || isBusy || state.isRefreshing
    const showAdvancedConfig = canAdvancedConfig && state.advancedAvailable

    return (
        <div className="grid min-w-0 gap-4">
            {state.isError ? (
                <p className={errorClassName} role="alert">
                    {t('admin.proxyHosts.config.errors.loadFailed')}
                </p>
            ) : null}
            {!state.data.enabled ? (
                <p className="m-0 rounded-xl border border-border bg-surface-subtle px-3 py-2 text-sm text-muted">
                    {t('admin.proxyHosts.config.disabledHost')}
                </p>
            ) : null}
            {!canEdit ? (
                <p className="m-0 text-sm text-muted">{t('admin.proxyHosts.config.readOnly')}</p>
            ) : null}
            {!canAdvancedConfig ? (
                <p className="m-0 text-sm leading-relaxed text-muted">
                    {t('admin.proxyHosts.config.advanced.hiddenSource')}
                </p>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <fieldset className="m-0 flex flex-wrap gap-1 border-0 p-0">
                    <legend className="sr-only">{t('admin.proxyHosts.config.views')}</legend>
                    {tabs
                        .filter(
                            (tab) =>
                                (canEdit || tab.value !== 'preview') &&
                                (canAdvancedConfig || tab.value !== 'active'),
                        )
                        .map((tab) => (
                            <button
                                key={tab.value}
                                type="button"
                                aria-pressed={state.activeTab === tab.value}
                                className={
                                    'rounded-lg px-3 py-2 text-xs font-bold outline-offset-2 focus-visible:outline-2 focus-visible:outline-brand-500 ' +
                                    (state.activeTab === tab.value
                                        ? 'bg-success-bg text-success-text'
                                        : 'text-muted hover:bg-surface-hover')
                                }
                                onClick={() => handler.setActiveTab(tab.value)}
                                disabled={tab.value === 'preview' && state.preview === null}
                            >
                                {t(tab.label)}
                            </button>
                        ))}
                </fieldset>
                <button
                    type="button"
                    className={uiClassNames.button.quiet}
                    onClick={handler.refresh}
                    disabled={isBusy || state.isRefreshing}
                >
                    <RefreshCw
                        aria-hidden="true"
                        className={state.isRefreshing ? 'size-4 animate-spin' : 'size-4'}
                    />
                    {t('admin.proxyHosts.config.reload')}
                </button>
            </div>
            <p id="proxy-config-settings-help" className="m-0 text-xs leading-relaxed text-muted">
                {state.activeTab === 'edit'
                    ? t(
                          state.templateAvailable
                              ? 'admin.proxyHosts.config.managedHelp'
                              : 'admin.proxyHosts.config.offlineHelp',
                      )
                    : state.activeTab === 'defaults'
                      ? t('admin.proxyHosts.config.inheritsDefaults')
                      : state.activeTab === 'preview'
                        ? t('admin.proxyHosts.config.previewDescription')
                        : t('admin.proxyHosts.config.sourceDescription')}
            </p>
            {state.activeTab === 'edit' ? (
                <h2 className="m-0 text-base font-extrabold text-ink-soft">
                    {t('admin.proxyHosts.config.advanced.structuredTitle')}
                </h2>
            ) : null}
            {sourceUnavailable ? (
                <p className="m-0 rounded-xl border border-border bg-surface-subtle p-5 text-sm text-muted">
                    {t('admin.proxyHosts.config.unavailable')}
                </p>
            ) : (
                <NginxConfigEditor
                    value={source}
                    onChange={handler.setDraft}
                    readOnly={readOnly}
                    label={t('admin.proxyHosts.config.sourceEditorLabel')}
                    descriptionId="proxy-config-settings-help"
                    fileName={state.data.proxyHostId + '.conf'}
                />
            )}
            {showAdvancedConfig && state.activeTab === 'edit' ? (
                <section
                    className="grid min-w-0 gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4"
                    aria-labelledby="proxy-advanced-config-title"
                >
                    <div className="grid gap-1">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <h2
                                id="proxy-advanced-config-title"
                                className="m-0 text-base font-extrabold text-ink-soft"
                            >
                                {t('admin.proxyHosts.config.advanced.title')}
                            </h2>
                            {!canEdit ? (
                                <span className="font-mono text-[0.68rem] font-bold tracking-[0.12em] text-amber-700 uppercase dark:text-amber-300">
                                    {t('admin.proxyHosts.config.readOnlyLabel')}
                                </span>
                            ) : null}
                        </div>
                        <p
                            id="proxy-advanced-config-help"
                            className="m-0 text-xs leading-relaxed text-muted"
                        >
                            {t('admin.proxyHosts.config.advanced.help')}
                        </p>
                    </div>
                    <p className="m-0 rounded-xl border border-amber-500/25 bg-surface-raised px-3 py-2 text-sm leading-relaxed text-ink-soft">
                        {t('admin.proxyHosts.config.advanced.warning')}
                    </p>
                    <NginxConfigEditor
                        value={state.advancedConfig}
                        onChange={handler.setAdvancedConfig}
                        readOnly={!canEdit || isBusy || state.isRefreshing}
                        label={t('admin.proxyHosts.config.advanced.label')}
                        descriptionId="proxy-advanced-config-help"
                        fileName={state.data.proxyHostId + '-advanced.conf'}
                        id="proxy-advanced-config-source"
                        heightClassName="h-[min(34vh,20rem)] min-h-48"
                    />
                    <p className="m-0 text-xs text-muted">
                        {t('admin.proxyHosts.config.advanced.limit')}
                    </p>
                </section>
            ) : null}
            {actionError ? (
                <p className={errorClassName} role="alert">
                    {actionError}
                </p>
            ) : null}
            {previewError ? (
                <p className={errorClassName} role="alert">
                    {previewError}
                </p>
            ) : null}
            <details className="rounded-xl border border-border bg-surface-subtle px-3 py-2 text-xs text-muted">
                <summary className="cursor-pointer font-bold text-ink-soft">
                    {t('admin.proxyHosts.config.sharedDefaults')}
                </summary>
                <p className="mb-2 leading-relaxed">
                    {t('admin.proxyHosts.config.inheritsDefaults')}
                </p>
                {state.data.commonSettingsSource ? (
                    <pre className="m-0 overflow-auto py-2 font-mono text-xs text-ink-soft">
                        {state.data.commonSettingsSource}
                    </pre>
                ) : (
                    <p className="mb-0">{t('admin.proxyHosts.config.nginxDefaults')}</p>
                )}
            </details>
            {canEdit && state.activeTab === 'edit' ? (
                <details className="text-xs text-muted">
                    <summary className="cursor-pointer font-bold">
                        {t('admin.proxyHosts.config.examples')}
                    </summary>
                    <div
                        className="mt-2 flex flex-wrap gap-2"
                        aria-label={t('admin.proxyHosts.config.examples')}
                    >
                        {PROXY_HTTP_SETTINGS.map(({ example }) => (
                            <code
                                key={example}
                                className="rounded-md border border-border bg-code px-2 py-1 font-mono text-[0.68rem] text-ink-soft"
                            >
                                {example}
                            </code>
                        ))}
                    </div>
                </details>
            ) : null}
        </div>
    )
}

export default function ProxyConfigEditorModal({
    canAdvancedConfig = false,
    canEdit,
    onOpenChange,
    open,
    proxyHost,
}: ProxyConfigEditorModalProps) {
    const { t } = useTranslationStore()
    const { handler, state } = useProxyConfigEditorLogic({
        canAdvancedConfig,
        canEdit,
        onOpenChange,
        open,
        proxyHost,
    })
    const isBusy = state.isSaving || state.isResetting || state.isPreviewing
    const actionsDisabled = state.data === undefined || isBusy || state.isRefreshing
    return (
        <>
            <Modal
                open={open}
                onOpenChange={onOpenChange}
                title={t('admin.proxyHosts.config.hostTitle', {
                    name: proxyHost.domains[0] ?? proxyHost.forwardHost,
                })}
                description={t('admin.proxyHosts.config.hostDescription')}
                size="lg"
                closeDisabled={
                    isBusy || state.isResetConfirmationOpen || state.isReloadConfirmationOpen
                }
                footer={
                    <>
                        <button
                            type="button"
                            className={uiClassNames.button.secondary}
                            onClick={() => onOpenChange(false)}
                            disabled={isBusy}
                        >
                            {t('common.cancel')}
                        </button>
                        {canEdit ? (
                            <>
                                <button
                                    type="button"
                                    className={uiClassNames.button.danger}
                                    onClick={handler.reset}
                                    disabled={actionsDisabled}
                                >
                                    <RotateCcw aria-hidden="true" className="size-4" />
                                    {t('admin.proxyHosts.config.resetButton')}
                                </button>
                                <button
                                    type="button"
                                    className={uiClassNames.button.secondary}
                                    onClick={handler.preview}
                                    disabled={actionsDisabled}
                                >
                                    <Eye aria-hidden="true" className="size-4" />
                                    {t(
                                        state.isPreviewing
                                            ? 'admin.proxyHosts.config.previewing'
                                            : 'admin.proxyHosts.config.preview',
                                    )}
                                </button>
                                <button
                                    type="button"
                                    className={uiClassNames.button.primary}
                                    onClick={handler.save}
                                    disabled={actionsDisabled}
                                >
                                    <Save aria-hidden="true" className="size-4" />
                                    {t(
                                        state.isSaving
                                            ? 'admin.proxyHosts.config.saving'
                                            : state.data?.enabled === false
                                              ? 'admin.proxyHosts.config.saveDisabled'
                                              : 'admin.proxyHosts.config.save',
                                    )}
                                </button>
                            </>
                        ) : null}
                    </>
                }
            >
                <EditorBody
                    canAdvancedConfig={canAdvancedConfig}
                    canEdit={canEdit}
                    handler={handler}
                    state={state}
                />
            </Modal>
            {state.isReloadConfirmationOpen ? (
                <ConfirmDialog
                    open
                    onOpenChange={handler.setReloadConfirmationOpen}
                    title={t('admin.proxyHosts.config.reloadTitle')}
                    description={t('admin.proxyHosts.config.reloadDescription')}
                    confirmLabel={t('admin.proxyHosts.config.reloadConfirm')}
                    pendingLabel={t('admin.proxyHosts.config.loading')}
                    isPending={state.isRefreshing}
                    onConfirm={handler.confirmReload}
                />
            ) : null}
            {canEdit && state.isResetConfirmationOpen ? (
                <ConfirmDialog
                    open
                    onOpenChange={handler.setResetConfirmationOpen}
                    title={t('admin.proxyHosts.config.hostResetTitle')}
                    description={
                        state.advancedAvailable
                            ? t('admin.proxyHosts.config.advanced.resetDescription', {
                                  name: proxyHost.domains[0] ?? proxyHost.forwardHost,
                              })
                            : t('admin.proxyHosts.config.hostResetDescription', {
                                  name: proxyHost.domains[0] ?? proxyHost.forwardHost,
                              })
                    }
                    confirmLabel={t('admin.proxyHosts.config.resetConfirm')}
                    pendingLabel={t('admin.proxyHosts.config.resetting')}
                    isPending={state.isResetting}
                    onConfirm={handler.confirmReset}
                />
            ) : null}
        </>
    )
}
