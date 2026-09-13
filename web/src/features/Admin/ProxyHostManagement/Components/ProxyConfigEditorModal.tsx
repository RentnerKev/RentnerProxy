import { RotateCcw, Save } from 'lucide-react'

import useTranslationStore from '../../../../language/useTranslationStore'
import { Modal } from '../../../../shared/Modal'
import { ConfirmDialog } from '../../../../shared/Modal/Components/ConfirmDialog'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import CaddyConfigCodeBlock from './CaddyConfigCodeBlock'
import useProxyConfigEditorLogic from '../Hooks/useProxyConfigEditorLogic'
import type { ProxyConfigEditorModalProps } from '../Types/proxy-config-editor.types'

const FIELDS = [
    ['clientMaxBodySizeBytes', 'fieldClientMaxBodySizeBytes', 1024, 1073741824, 'bytes'],
    ['proxyConnectTimeoutSeconds', 'fieldProxyConnectTimeoutSeconds', 1, 60, 'seconds'],
    ['proxyReadTimeoutSeconds', 'fieldProxyReadTimeoutSeconds', 1, 3600, 'seconds'],
    ['proxySendTimeoutSeconds', 'fieldProxySendTimeoutSeconds', 1, 3600, 'seconds'],
] as const

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
                        {!state.data.enabled ? (
                            <p className="m-0 rounded-xl border border-border bg-surface-subtle px-3 py-2 text-sm text-muted">
                                {t('admin.proxyHosts.config.disabledHost')}
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
                        ) : state.activeTab === 'active' && source ? (
                            <CaddyConfigCodeBlock
                                source={source}
                                ariaLabel={t('admin.proxyHosts.config.active')}
                            />
                        ) : (
                            <p className="m-0 text-sm text-muted">
                                {t('admin.proxyHosts.config.unavailable')}
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
