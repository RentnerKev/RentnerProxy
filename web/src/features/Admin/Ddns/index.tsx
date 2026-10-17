import { Settings2 } from 'lucide-react'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import ContentState from '@/shared/Management/ContentState.tsx'
import PageHeader from '@/shared/Management/PageHeader.tsx'
import { ConfirmDialog } from '@/shared/Modal/Components/ConfirmDialog.tsx'
import DdnsSettings from './Components/DdnsSettings.tsx'
import DdnsRecords from './Components/DdnsRecords.tsx'
import DdnsRecordEditor from './Components/DdnsRecordEditor.tsx'
import useDdnsLogic from './Hooks/useDdnsLogic.ts'
import type { DdnsPageProps } from './Types/ddns-ui.types.ts'

export default function DdnsPage(props: DdnsPageProps) {
    const { state, handler } = useDdnsLogic(props)
    const { t } = useTranslationStore()
    return (
        <>
            <PageHeader
                eyebrow={t('admin.ddns.page.eyebrow')}
                title={t('admin.ddns.page.title')}
                description={t('admin.ddns.page.description')}
            />
            {state.isLoading ? (
                <ContentState
                    busy
                    title={t('common.loading')}
                    description={t('admin.ddns.states.loading')}
                />
            ) : !state.canView ? (
                <ContentState
                    title={t('admin.ddns.states.forbidden')}
                    description={t('admin.ddns.states.readOnly')}
                />
            ) : state.snapshot ? (
                <div className="grid gap-5">
                    <section
                        className="grid gap-5 rounded-2xl border border-border bg-surface-subtle p-5 sm:p-6"
                        aria-label={t('admin.ddns.status.title')}
                    >
                        <div className="flex flex-wrap items-center justify-between gap-4">
                            <div className="flex items-center gap-3">
                                <span
                                    aria-hidden="true"
                                    className={`h-2.5 w-2.5 rounded-full ${state.settings?.enabled ? 'bg-accent' : 'bg-muted'}`}
                                />
                                <div>
                                    <p className="text-xs font-bold uppercase tracking-wider text-muted">
                                        {t('admin.ddns.status.title')}
                                    </p>
                                    <h2 className="mt-1 text-xl font-extrabold text-ink-soft">
                                        {t(
                                            state.snapshot.inFlight
                                                ? 'admin.ddns.states.running'
                                                : state.snapshot.restorePaused
                                                  ? 'admin.ddns.states.restorePaused'
                                                  : state.settings?.enabled
                                                    ? 'admin.ddns.states.enabled'
                                                    : state.settings
                                                      ? 'admin.ddns.states.disabled'
                                                      : 'admin.ddns.states.empty',
                                        )}
                                    </h2>
                                </div>
                            </div>
                            {state.canManage ? (
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={handler.editSettings}
                                        disabled={state.locked}
                                        className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border-strong bg-surface-raised px-4 text-sm font-extrabold text-ink-soft disabled:opacity-50"
                                    >
                                        <Settings2 size={16} aria-hidden="true" />
                                        {t('admin.ddns.actions.settings')}
                                    </button>
                                    {state.settings?.enabled ? (
                                        <>
                                            <button
                                                type="button"
                                                onClick={handler.sync}
                                                disabled={state.locked}
                                                className="min-h-11 rounded-xl border border-border-strong bg-surface-raised px-4 text-sm font-extrabold text-ink-soft disabled:opacity-50"
                                            >
                                                {t('admin.ddns.actions.sync')}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={handler.disable}
                                                disabled={state.isPending || !state.available}
                                                className="min-h-11 rounded-xl border border-danger-border bg-danger-bg px-4 text-sm font-extrabold text-danger-text disabled:opacity-50"
                                            >
                                                {t('admin.ddns.actions.disable')}
                                            </button>
                                        </>
                                    ) : state.canEnable ? (
                                        <button
                                            type="button"
                                            onClick={handler.enable}
                                            disabled={state.locked}
                                            className="min-h-11 rounded-xl bg-accent px-4 text-sm font-extrabold text-accent-foreground disabled:opacity-50"
                                        >
                                            {t('admin.ddns.actions.enable')}
                                        </button>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>
                        <dl className="grid gap-4 border-t border-border pt-5 text-sm sm:grid-cols-3">
                            <div>
                                <dt className="text-xs text-muted">
                                    {t('admin.ddns.status.ipv4')}
                                </dt>
                                <dd className="mt-1 break-all font-mono text-ink-soft">
                                    {state.discoveredIpv4 ?? '—'}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-xs text-muted">
                                    {t('admin.ddns.status.ipv6')}
                                </dt>
                                <dd className="mt-1 break-all font-mono text-ink-soft">
                                    {state.discoveredIpv6 ?? '—'}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-xs text-muted">
                                    {t('admin.ddns.status.lastRun')}
                                </dt>
                                <dd className="mt-1 text-ink-soft">{state.lastRun}</dd>
                            </div>
                        </dl>
                        {state.settings ? (
                            <p className="text-xs text-muted">
                                {t('admin.ddns.status.schedule', {
                                    seconds: state.settings.intervalSeconds,
                                    startup: t(
                                        state.settings.updateOnStart
                                            ? 'admin.ddns.states.enabled'
                                            : 'admin.ddns.states.disabled',
                                    ),
                                })}
                            </p>
                        ) : null}
                        {state.snapshot.restorePaused ? (
                            <p className="text-sm text-muted">
                                {t('admin.ddns.status.restoreHint')}
                            </p>
                        ) : null}
                        {state.snapshot.providerNotBefore ? (
                            <p className="text-sm text-muted">
                                {t('admin.ddns.status.cooldown', { at: state.providerRetry })}
                            </p>
                        ) : null}
                    </section>
                    <DdnsRecords
                        rows={state.rows}
                        canManage={state.canManage}
                        canAdd={state.canChooseConnection}
                        locked={state.locked}
                        onAdd={handler.add}
                        onEdit={handler.edit}
                        onToggle={handler.toggle}
                        onDelete={handler.askDelete}
                    />
                </div>
            ) : (
                <ContentState
                    title={t('admin.ddns.status.title')}
                    description={t('admin.ddns.states.waiting')}
                />
            )}
            {state.recordEditor ? (
                <DdnsRecordEditor
                    editor={state.recordEditor}
                    connections={state.connections}
                    canChooseConnection={state.canChooseConnection}
                    pending={state.isPending}
                    locked={state.locked}
                    stale={state.stale}
                    onClose={handler.closeRecord}
                    onSave={handler.saveRecord}
                />
            ) : null}
            {state.settingsEditor ? (
                <DdnsSettings
                    draft={state.settingsEditor.draft}
                    revision={state.settingsEditor.revision}
                    pending={state.isPending}
                    locked={state.locked}
                    stale={state.stale}
                    onClose={handler.closeSettings}
                    onSave={handler.saveSettings}
                />
            ) : null}
            <ConfirmDialog
                open={!!state.deleteTarget}
                onOpenChange={handler.closeDelete}
                title={t('admin.ddns.delete.title')}
                description={t('admin.ddns.delete.description', { name: state.deleteTarget?.name })}
                confirmLabel={t('common.delete')}
                destructive
                isPending={state.isPending}
                onConfirm={handler.confirmDelete}
            />
        </>
    )
}
