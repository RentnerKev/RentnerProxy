import { Code2, Settings2 } from 'lucide-react'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
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
                                    className={buttonClassName('primary')}
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
                <DiscoveryTable
                    rows={state.overview?.rows ?? []}
                    loading={state.loading}
                    locked={state.locked}
                    canDetach={state.canDetach}
                    onDetails={handler.showDetails}
                    onDetach={handler.askDetach}
                />
            ) : (
                <ContentState
                    title={t('admin.dockerDiscovery.page.title')}
                    description={t('errors.permission_denied')}
                />
            )}
            {state.canManage && state.connection ? (
                <DiscoveryConnection
                    context={state.connection}
                    runtime={{
                        status: state.connectorStatus,
                        endpoint: state.overview?.snapshot?.configuration.settings.endpoint ?? '',
                        locked: state.locked,
                        needsActivation: state.needsActivation,
                        canEnable: state.canEnable,
                        canRetry: state.canRetry,
                        showRetry: state.showRetry,
                        appliedStatus:
                            state.overview?.management.enabled && !state.needsActivation
                                ? state.overview.management.runtimeStatus
                                : null,
                    }}
                    api={props.api}
                    pending={state.busy}
                    onClose={handler.closeConnection}
                    onSave={handler.saveConnection}
                    onDisconnect={handler.disconnect}
                    onEnable={handler.askEnable}
                    onDisable={handler.disable}
                    onRetry={handler.retry}
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
