import { Code2, Settings2, RotateCw } from 'lucide-react'
import PageHeader from '@/shared/Management/PageHeader.tsx'
import ContentState from '@/shared/Management/ContentState.tsx'
import { ConfirmDialog } from '@/shared/Modal/Components/ConfirmDialog.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useDockerDiscoveryLogic from './Hooks/useDockerDiscoveryLogic.ts'
import DiscoveryTable from './Components/DiscoveryTable/index.tsx'
import DiscoveryConnection from './Components/DiscoveryConnection/index.tsx'
import DiscoveryDetails from './Components/DiscoveryDetails.tsx'
import DiscoveryGuide from './Components/DiscoveryGuide.tsx'
import type { DockerDiscoveryPageProps } from './Types/discovery-ui.types.ts'

export default function DockerDiscoveryPage(props: DockerDiscoveryPageProps) {
    const { t } = useTranslationStore()
    const { state, handler } = useDockerDiscoveryLogic(props)
    return (
        <>
            <PageHeader
                eyebrow={t('admin.dockerDiscovery.page.eyebrow')}
                title={t('admin.dockerDiscovery.page.title')}
                description={t('admin.dockerDiscovery.page.description')}
                action={
                    state.canView ? (
                        <>
                            <button
                                type="button"
                                onClick={handler.openGuide}
                                className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border bg-surface-raised px-3 text-sm font-bold text-ink-soft hover:bg-surface-hover"
                            >
                                <Code2 size={16} aria-hidden="true" />
                                {t('admin.dockerDiscovery.actions.guide')}
                            </button>
                            {state.canManage ? (
                                <button
                                    type="button"
                                    onClick={handler.openConnection}
                                    disabled={state.locked}
                                    className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border bg-surface-raised px-3 text-sm font-bold text-ink-soft hover:bg-surface-hover disabled:opacity-50"
                                >
                                    <Settings2 size={16} aria-hidden="true" />
                                    {t('admin.dockerDiscovery.actions.connection')}
                                </button>
                            ) : null}
                        </>
                    ) : undefined
                }
            />
            {state.canView ? (
                <div className="grid gap-6">
                    <section
                        aria-label={t('admin.dockerDiscovery.runtime.title')}
                        className="grid gap-4 rounded-2xl border border-border bg-surface p-5"
                    >
                        <div className="flex flex-wrap items-center justify-between gap-4">
                            <div className="grid min-w-0 gap-2">
                                <h2 className="text-base font-extrabold text-ink-soft">
                                    {t('admin.dockerDiscovery.runtime.title')}
                                </h2>
                                <p className="font-mono text-xs wrap-anywhere text-muted">
                                    {state.overview?.snapshot?.configuration.settings.endpoint ??
                                        t('admin.dockerDiscovery.runtime.notConfigured')}
                                </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <output className="rounded-full border border-border bg-surface-raised px-3 py-1.5 text-xs font-bold text-ink-soft">
                                    {t(`admin.dockerDiscovery.connector.${state.connectorStatus}`)}
                                </output>
                                {state.canManage && state.overview ? (
                                    <button
                                        type="button"
                                        disabled={
                                            state.locked ||
                                            (state.needsActivation && !state.canEnable)
                                        }
                                        onClick={
                                            state.needsActivation
                                                ? handler.askEnable
                                                : handler.disable
                                        }
                                        className="min-h-9 rounded-lg border border-border bg-surface-raised px-3 text-xs font-bold text-ink-soft hover:bg-surface-hover disabled:opacity-50"
                                    >
                                        {t(
                                            state.needsActivation
                                                ? 'admin.dockerDiscovery.actions.enable'
                                                : 'admin.dockerDiscovery.actions.disable',
                                        )}
                                    </button>
                                ) : null}
                                {state.showRetry && state.canRetry ? (
                                    <button
                                        type="button"
                                        onClick={handler.retry}
                                        disabled={state.locked}
                                        className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 text-xs font-bold text-ink-soft hover:bg-surface-hover disabled:opacity-50"
                                    >
                                        <RotateCw size={14} aria-hidden="true" />
                                        {t('admin.dockerDiscovery.actions.retry')}
                                    </button>
                                ) : null}
                            </div>
                        </div>
                        <p className="text-sm text-muted">
                            {t(
                                state.needsActivation
                                    ? 'admin.dockerDiscovery.runtime.preview'
                                    : 'admin.dockerDiscovery.runtime.active',
                            )}
                        </p>
                        {state.overview?.snapshot?.status === 'paused' ? (
                            <p className="text-sm text-muted">
                                {t('admin.dockerDiscovery.runtime.restorePaused')}
                            </p>
                        ) : null}
                        {state.overview?.management.enabled && !state.needsActivation ? (
                            <p className="text-xs text-muted">
                                {t(
                                    `admin.dockerDiscovery.applied.${state.overview.management.runtimeStatus}`,
                                )}
                            </p>
                        ) : null}
                    </section>
                    <DiscoveryTable
                        rows={state.overview?.rows ?? []}
                        loading={state.loading}
                        locked={state.locked}
                        canDetach={state.canDetach}
                        onDetails={handler.showDetails}
                        onDetach={handler.askDetach}
                    />
                </div>
            ) : (
                <ContentState
                    title={t('admin.dockerDiscovery.page.title')}
                    description={t('errors.permission_denied')}
                />
            )}
            {state.canManage && state.connection ? (
                <DiscoveryConnection
                    context={state.connection}
                    api={props.api}
                    pending={state.busy}
                    onClose={handler.closeConnection}
                    onSave={handler.saveConnection}
                    onDisconnect={handler.disconnect}
                />
            ) : null}
            {state.canView && state.details ? (
                <DiscoveryDetails
                    row={state.details}
                    candidate={state.candidate}
                    onClose={handler.closeDetails}
                />
            ) : null}
            {state.canView && state.guide ? (
                <DiscoveryGuide
                    mode={state.guideMode}
                    onModeChange={handler.setGuideMode}
                    onClose={handler.closeGuide}
                    onCopy={handler.copyExample}
                />
            ) : null}
            <ConfirmDialog
                open={state.canManage && state.confirmation !== null}
                onOpenChange={handler.closeConfirmation}
                isPending={state.busy}
                onConfirm={handler.confirm}
                destructive={state.confirmation?.kind === 'detach'}
                title={t(
                    state.confirmation?.kind === 'detach'
                        ? 'admin.dockerDiscovery.confirm.detachTitle'
                        : 'admin.dockerDiscovery.confirm.enableTitle',
                )}
                description={
                    state.confirmation?.kind === 'detach'
                        ? t('admin.dockerDiscovery.confirm.detachDescription', {
                              name: state.confirmation.name,
                          })
                        : t('admin.dockerDiscovery.confirm.enableDescription', {
                              create: state.confirmation?.create ?? 0,
                              update: state.confirmation?.update ?? 0,
                          })
                }
                confirmLabel={t(
                    state.confirmation?.kind === 'detach'
                        ? 'admin.dockerDiscovery.actions.detach'
                        : 'admin.dockerDiscovery.actions.enable',
                )}
            />
        </>
    )
}
