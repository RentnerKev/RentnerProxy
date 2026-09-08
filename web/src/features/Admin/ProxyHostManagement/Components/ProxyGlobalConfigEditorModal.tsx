import { Eye, RefreshCw, RotateCcw, Save } from 'lucide-react'

import useTranslationStore from '../../../../language/useTranslationStore'
import { Modal } from '../../../../shared/Modal'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import useProxyGlobalConfigEditorLogic from '../Hooks/useProxyGlobalConfigEditorLogic'
import type {
    ProxyConfigEditorTab,
    ProxyGlobalConfigEditorModalProps,
} from '../Types/proxy-config-editor.types'

const FIELDS = [
    ['clientMaxBodySizeBytes', 'fieldClientMaxBodySizeBytes', 1024, 1073741824, 'bytes'],
    ['proxyConnectTimeoutSeconds', 'fieldProxyConnectTimeoutSeconds', 1, 60, 'seconds'],
    ['proxyReadTimeoutSeconds', 'fieldProxyReadTimeoutSeconds', 1, 3600, 'seconds'],
    ['proxySendTimeoutSeconds', 'fieldProxySendTimeoutSeconds', 1, 3600, 'seconds'],
    ['sendTimeoutSeconds', 'fieldSendTimeoutSeconds', 1, 300, 'seconds'],
    ['keepaliveTimeoutSeconds', 'fieldKeepaliveTimeoutSeconds', 1, 300, 'seconds'],
] as const

export default function ProxyGlobalConfigEditorModal(props: ProxyGlobalConfigEditorModalProps) {
    const { t } = useTranslationStore()
    const { state, handler } = useProxyGlobalConfigEditorLogic(props)
    const busy = state.isRefreshing || state.isSaving || state.isResetting || state.isPreviewing
    const source =
        state.activeTab === 'active'
            ? state.data?.active?.config
            : state.activeTab === 'defaults'
              ? state.data?.defaults?.config
              : state.activeTab === 'preview'
                ? state.preview?.config
                : undefined
    return (
        <Modal
            open={props.open}
            onOpenChange={props.onOpenChange}
            title={t('admin.proxyHosts.config.globalTitle')}
            description={t('admin.proxyHosts.config.globalDescription')}
            size="lg"
            closeDisabled={busy}
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
                    <div className="flex flex-wrap gap-1">
                        {(
                            [
                                'edit',
                                'active',
                                'defaults',
                                ...(state.preview ? ['preview'] : []),
                            ] as ProxyConfigEditorTab[]
                        ).map((tab) => (
                            <button
                                key={tab}
                                type="button"
                                className={uiClassNames.button.quiet}
                                onClick={() => handler.setActiveTab(tab)}
                                aria-pressed={state.activeTab === tab}
                                disabled={busy}
                            >
                                {t(`admin.proxyHosts.config.${tab === 'edit' ? 'settings' : tab}`)}
                            </button>
                        ))}
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
                            {FIELDS.map(([key, labelKey, min, max, unitKey]) => (
                                <label key={key} className="grid gap-1 text-sm text-ink-soft">
                                    {t(`admin.proxyHosts.config.${labelKey}`)}
                                    <span className="flex items-center gap-2">
                                        <input
                                            className={uiClassNames.form.control}
                                            type="number"
                                            min={min}
                                            max={max}
                                            value={state.settings[key] ?? ''}
                                            onChange={(event) =>
                                                handler.setSetting(
                                                    key,
                                                    event.target.value === ''
                                                        ? undefined
                                                        : Number(event.target.value),
                                                )
                                            }
                                            disabled={!props.canEdit || busy}
                                        />
                                        <small className="text-muted">
                                            {t(`admin.proxyHosts.config.${unitKey}`)}
                                        </small>
                                    </span>
                                </label>
                            ))}
                        </fieldset>
                    ) : source ? (
                        <pre className="max-h-96 overflow-auto rounded-xl border border-border bg-code p-3 text-xs text-ink-soft">
                            {source}
                        </pre>
                    ) : (
                        <p className="m-0 text-sm text-muted">
                            {t('admin.proxyHosts.config.unavailable')}
                        </p>
                    )}
                    {state.actionError ? (
                        <p role="alert" className="m-0 text-danger-text">
                            {t(state.actionError, {
                                defaultValue: t('admin.proxyHosts.config.errors.saveFailed'),
                            })}
                        </p>
                    ) : null}
                </div>
            )}
        </Modal>
    )
}
