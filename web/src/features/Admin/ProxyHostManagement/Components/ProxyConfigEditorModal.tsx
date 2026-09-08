import { RefreshCw, RotateCcw, Save, Eye } from 'lucide-react'
import useTranslationStore from '../../../../language/useTranslationStore'
import { ConfirmDialog } from '../../../../shared/Modal/Components/ConfirmDialog'
import { Modal } from '../../../../shared/Modal'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import type { ProxyHttpSettings } from '../../../../shared/Types/proxy-runtime.types'
import useProxyConfigEditorLogic from '../Hooks/useProxyConfigEditorLogic'
import type { ProxyConfigEditorModalProps } from '../Types/proxy-config-editor.types'

const FIELDS: ReadonlyArray<{
    key: keyof ProxyHttpSettings
    labelKey: string
    min: number
    max: number
    unitKey: string
}> = [
    {
        key: 'clientMaxBodySizeBytes',
        labelKey: 'fieldClientMaxBodySizeBytes',
        min: 1024,
        max: 1073741824,
        unitKey: 'bytes',
    },
    {
        key: 'proxyConnectTimeoutSeconds',
        labelKey: 'fieldProxyConnectTimeoutSeconds',
        min: 1,
        max: 60,
        unitKey: 'seconds',
    },
    {
        key: 'proxyReadTimeoutSeconds',
        labelKey: 'fieldProxyReadTimeoutSeconds',
        min: 1,
        max: 3600,
        unitKey: 'seconds',
    },
    {
        key: 'proxySendTimeoutSeconds',
        labelKey: 'fieldProxySendTimeoutSeconds',
        min: 1,
        max: 3600,
        unitKey: 'seconds',
    },
]

function ReadOnlySource({ source }: { readonly source: string | undefined }) {
    const { t } = useTranslationStore()
    return source ? (
        <pre className="max-h-72 overflow-auto rounded-xl border border-border bg-code p-3 text-xs text-ink-soft">
            {source}
        </pre>
    ) : (
        <p className="m-0 text-sm text-muted">{t('admin.proxyHosts.config.unavailable')}</p>
    )
}

export default function ProxyConfigEditorModal({
    canEdit,
    onOpenChange,
    open,
    proxyHost,
}: ProxyConfigEditorModalProps) {
    const { t } = useTranslationStore()
    const { handler, state } = useProxyConfigEditorLogic({ canEdit, onOpenChange, open, proxyHost })
    const busy = state.isSaving || state.isResetting || state.isPreviewing || state.isRefreshing
    const source =
        state.activeTab === 'active'
            ? state.data?.active?.config
            : state.activeTab === 'defaults'
              ? state.data?.defaults?.config
              : state.activeTab === 'preview'
                ? state.preview?.config
                : undefined
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
                    busy || state.isResetConfirmationOpen || state.isReloadConfirmationOpen
                }
                footer={
                    <>
                        <button
                            type="button"
                            className={uiClassNames.button.secondary}
                            onClick={() => onOpenChange(false)}
                            disabled={busy}
                        >
                            {t('common.cancel')}
                        </button>
                        {canEdit ? (
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
                                    className={uiClassNames.button.secondary}
                                    onClick={handler.preview}
                                    disabled={busy || !state.data}
                                >
                                    <Eye className="size-4" />
                                    {t('admin.proxyHosts.config.preview')}
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
                        {!state.data.enabled ? (
                            <p className="m-0 rounded-xl border border-border bg-surface-subtle px-3 py-2 text-sm text-muted">
                                {t('admin.proxyHosts.config.disabledHost')}
                            </p>
                        ) : null}
                        <div className="flex flex-wrap gap-1">
                            <button
                                type="button"
                                className={uiClassNames.button.quiet}
                                onClick={() => handler.setActiveTab('edit')}
                                aria-pressed={state.activeTab === 'edit'}
                            >
                                {t('admin.proxyHosts.config.settings')}
                            </button>
                            <button
                                type="button"
                                className={uiClassNames.button.quiet}
                                onClick={() => handler.setActiveTab('active')}
                                aria-pressed={state.activeTab === 'active'}
                            >
                                {t('admin.proxyHosts.config.active')}
                            </button>
                            <button
                                type="button"
                                className={uiClassNames.button.quiet}
                                onClick={() => handler.setActiveTab('defaults')}
                                aria-pressed={state.activeTab === 'defaults'}
                            >
                                {t('admin.proxyHosts.config.defaults')}
                            </button>
                            {state.preview ? (
                                <button
                                    type="button"
                                    className={uiClassNames.button.quiet}
                                    onClick={() => handler.setActiveTab('preview')}
                                    aria-pressed={state.activeTab === 'preview'}
                                >
                                    {t('admin.proxyHosts.config.preview')}
                                </button>
                            ) : null}
                            <button
                                type="button"
                                className={uiClassNames.button.quiet}
                                onClick={handler.refresh}
                                disabled={busy}
                            >
                                <RefreshCw className="size-4" />
                                {t('admin.proxyHosts.config.reload')}
                            </button>
                        </div>
                        {state.activeTab === 'edit' ? (
                            <fieldset className="grid gap-3">
                                <legend className="text-base font-extrabold text-ink-soft">
                                    {t('admin.proxyHosts.config.settings')}
                                </legend>
                                {FIELDS.map((field) => (
                                    <label
                                        key={field.key}
                                        className="grid gap-1 text-sm text-ink-soft"
                                    >
                                        {t(`admin.proxyHosts.config.${field.labelKey}`)}
                                        <span className="flex items-center gap-2">
                                            <input
                                                className="w-full rounded-lg border border-border bg-surface px-3 py-2"
                                                type="number"
                                                min={field.min}
                                                max={field.max}
                                                value={state.settings[field.key] ?? ''}
                                                onChange={(event) =>
                                                    handler.setSetting(
                                                        field.key,
                                                        event.target.value === ''
                                                            ? undefined
                                                            : Number(event.target.value),
                                                    )
                                                }
                                                disabled={!canEdit || busy}
                                            />
                                            <small className="text-muted">
                                                {t(`admin.proxyHosts.config.${field.unitKey}`)}
                                            </small>
                                        </span>
                                    </label>
                                ))}
                            </fieldset>
                        ) : (
                            <ReadOnlySource source={source} />
                        )}
                        {state.actionError ? (
                            <p role="alert" className="m-0 text-danger-text">
                                {t(state.actionError, {
                                    defaultValue: t('admin.proxyHosts.config.errors.saveFailed'),
                                })}
                            </p>
                        ) : null}
                        {state.previewError ? (
                            <p role="alert" className="m-0 text-danger-text">
                                {t(state.previewError, {
                                    defaultValue: t('admin.proxyHosts.config.errors.previewFailed'),
                                })}
                            </p>
                        ) : null}
                    </div>
                )}
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
            {state.isResetConfirmationOpen ? (
                <ConfirmDialog
                    open
                    onOpenChange={handler.setResetConfirmationOpen}
                    title={t('admin.proxyHosts.config.hostResetTitle')}
                    description={t('admin.proxyHosts.config.hostResetDescription', {
                        name: proxyHost.domains[0] ?? proxyHost.forwardHost,
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
