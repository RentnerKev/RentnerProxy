import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import ContentState from '@/shared/Management/ContentState.tsx'
import PageHeader from '@/shared/Management/PageHeader.tsx'
import { ConfirmDialog } from '@/shared/Modal/Components/ConfirmDialog.tsx'
import DdnsSettings from './Components/DdnsSettings.tsx'
import DdnsRecords from './Components/DdnsRecords.tsx'
import useDdnsLogic from './Hooks/useDdnsLogic.ts'
import type { DdnsPageProps } from './Types/ddns-ui.types.ts'

export default function DdnsPage(props: DdnsPageProps) {
    const logic = useDdnsLogic(props)
    const { state, handler } = logic
    const { t } = useTranslationStore()
    return (
        <>
            <PageHeader
                eyebrow={t('admin.ddns.page.eyebrow')}
                title={t('admin.ddns.page.title')}
                description={t('admin.ddns.page.description')}
            />
            <div className="mb-5 flex flex-wrap gap-2 sm:justify-end">
                <button
                    type="button"
                    onClick={handler.refresh}
                    disabled={state.isPending}
                    className="min-h-11 rounded-xl border border-border-strong bg-surface-raised px-4 py-2 text-sm font-extrabold text-ink-soft disabled:opacity-50"
                >
                    {t('admin.ddns.actions.refresh')}
                </button>
                {state.canManage && !state.editing ? (
                    <button
                        type="button"
                        onClick={handler.edit}
                        disabled={state.locked}
                        className="min-h-11 rounded-xl bg-accent px-4 py-2 text-sm font-extrabold text-accent-foreground disabled:opacity-50"
                    >
                        {t(
                            state.settings
                                ? 'admin.ddns.actions.edit'
                                : 'admin.ddns.actions.configure',
                        )}
                    </button>
                ) : null}
            </div>
            {state.error ? (
                <p
                    role="alert"
                    className="mb-4 rounded-xl bg-danger-bg p-4 text-sm text-danger-text"
                >
                    {t(state.error)}
                </p>
            ) : null}
            {state.notice ? (
                <output className="mb-4 block rounded-xl border border-border bg-surface-subtle p-4 text-sm text-ink-soft">
                    {t(state.notice)}
                </output>
            ) : null}
            {state.isError ? (
                <p
                    role="alert"
                    className="mb-4 rounded-xl bg-danger-bg p-4 text-sm text-danger-text"
                >
                    {t('admin.ddns.errors.controller_unavailable')}
                </p>
            ) : null}
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
                        className="grid gap-4 rounded-2xl border border-border bg-surface-subtle p-5 sm:p-6"
                        aria-label={t('admin.ddns.status.title')}
                    >
                        <div className="flex flex-wrap items-center justify-between gap-3">
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
                            {state.canManage && !state.editing && state.settings?.enabled ? (
                                <div className="flex flex-wrap gap-2">
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
                                        onClick={handler.askDisable}
                                        disabled={state.isPending || !state.available}
                                        className="min-h-11 rounded-xl border border-border-strong px-4 text-sm font-extrabold text-danger-text disabled:opacity-50"
                                    >
                                        {t('admin.ddns.actions.disable')}
                                    </button>
                                </div>
                            ) : null}
                        </div>
                        <dl className="grid gap-3 text-sm sm:grid-cols-3">
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
                    {!state.canManage ? (
                        <p className="text-sm text-muted">{t('admin.ddns.states.readOnly')}</p>
                    ) : null}
                    {state.stale ? (
                        <p
                            role="alert"
                            className="rounded-xl bg-danger-bg p-4 text-sm text-danger-text"
                        >
                            {t('admin.ddns.errors.conflict')}
                        </p>
                    ) : null}
                    <form
                        id={state.formId}
                        onSubmit={handler.submit}
                        className="grid gap-5"
                        aria-busy={state.isPending}
                    >
                        {state.editing ? <DdnsSettings {...logic} /> : null}
                        <DdnsRecords {...logic} />
                        {state.editing || (state.canManage && state.canActivate) ? (
                            <section
                                aria-labelledby={`${state.formId}-preview`}
                                className="grid gap-4 rounded-2xl border border-border bg-surface p-5 sm:p-6"
                            >
                                <div>
                                    <h2
                                        id={`${state.formId}-preview`}
                                        className="text-lg font-extrabold text-ink-soft"
                                    >
                                        {t('admin.ddns.preview.title')}
                                    </h2>
                                    <p className="mt-2 text-sm leading-relaxed text-muted">
                                        {t('admin.ddns.preview.hint')}
                                    </p>
                                </div>
                                {state.currentPreview ? (
                                    <output className="text-sm font-bold text-ink-soft">
                                        {t(
                                            state.previewReady
                                                ? 'admin.ddns.preview.ready'
                                                : state.canApprove
                                                  ? 'admin.ddns.preview.approval'
                                                  : 'admin.ddns.preview.blocked',
                                        )}
                                    </output>
                                ) : (
                                    <p className="text-sm text-muted">
                                        {t('admin.ddns.preview.required')}
                                    </p>
                                )}
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        disabled={state.locked}
                                        onClick={handler.preview}
                                        className="min-h-11 rounded-xl border border-border-strong bg-surface-raised px-4 py-2 text-sm font-extrabold text-ink-soft disabled:opacity-50"
                                    >
                                        {t(
                                            state.isPending
                                                ? 'common.working'
                                                : 'admin.ddns.actions.preview',
                                        )}
                                    </button>
                                    {state.canApprove ? (
                                        <button
                                            type="button"
                                            disabled={state.locked}
                                            onClick={handler.approve}
                                            className="min-h-11 rounded-xl border border-accent-border px-4 py-2 text-sm font-extrabold text-accent-ring disabled:opacity-50"
                                        >
                                            {t('admin.ddns.actions.approve')}
                                        </button>
                                    ) : null}
                                    {state.editing ? (
                                        <>
                                            <button
                                                type="submit"
                                                disabled={state.locked || !state.previewReady}
                                                className="min-h-11 rounded-xl bg-accent px-4 py-2 text-sm font-extrabold text-accent-foreground disabled:opacity-50"
                                            >
                                                {t('admin.ddns.actions.save')}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={handler.cancel}
                                                disabled={state.isPending}
                                                className="min-h-11 rounded-xl border border-border-strong px-4 py-2 text-sm font-extrabold text-ink-soft disabled:opacity-50"
                                            >
                                                {t('common.cancel')}
                                            </button>
                                        </>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={handler.askEnable}
                                            disabled={state.locked || !state.previewReady}
                                            className="min-h-11 rounded-xl bg-accent px-4 py-2 text-sm font-extrabold text-accent-foreground disabled:opacity-50"
                                        >
                                            {t('admin.ddns.actions.enable')}
                                        </button>
                                    )}
                                </div>
                            </section>
                        ) : null}
                    </form>
                    <p className="text-sm leading-relaxed text-muted">
                        {t('admin.ddns.page.networkHint')}
                    </p>
                </div>
            ) : null}
            <ConfirmDialog
                open={!!state.confirmation}
                onOpenChange={handler.closeConfirmation}
                title={t(`admin.ddns.confirm.${state.confirmation ?? 'save'}.title`)}
                description={t(`admin.ddns.confirm.${state.confirmation ?? 'save'}.description`, {
                    removed: state.removedCount,
                })}
                confirmLabel={t(`admin.ddns.confirm.${state.confirmation ?? 'save'}.action`)}
                destructive={state.confirmation === 'disable' || state.confirmation === 'discard'}
                isPending={state.isPending}
                onConfirm={handler.confirm}
            />
        </>
    )
}
