import { Archive } from 'lucide-react'
import { formatBackupDate } from '@/lib/Backups/presentation.ts'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import ContentState from '@/shared/Management/ContentState.tsx'
import PageHeader from '@/shared/Management/PageHeader.tsx'
import { ConfirmDialog } from '@/shared/Modal/Components/ConfirmDialog.tsx'
import BackupHistory from './Components/BackupHistory/index.tsx'
import OffHostBackup from './Components/OffHostBackup.tsx'
import BackupSchedule from './Components/BackupSchedule.tsx'
import BackupStateBadge from './Components/BackupStateBadge.tsx'
import useBackupsLogic from './Hooks/useBackupsLogic.ts'
import type { BackupsPageProps } from './Types/backups-ui.types.ts'

export default function BackupsPage(props: BackupsPageProps) {
    const { t, locale } = useTranslationStore()
    const { state, handler } = useBackupsLogic(props)
    return (
        <div className="grid gap-5">
            <PageHeader
                eyebrow={t('admin.backups.eyebrow')}
                title={t('admin.backups.title')}
                description={t('admin.backups.description')}
                action={
                    !state.forbidden ? (
                        <div className="flex flex-wrap gap-3">
                            {state.canManage ? (
                                <button
                                    type="button"
                                    className={buttonClassName('primary')}
                                    onClick={handler.handleStart}
                                    disabled={state.locked || !!state.active}
                                >
                                    <Archive aria-hidden="true" className="size-4" />
                                    {t(
                                        state.uncertain
                                            ? 'admin.backups.retryStart'
                                            : 'admin.backups.start',
                                    )}
                                </button>
                            ) : null}
                        </div>
                    ) : null
                }
            />
            {state.forbidden ? (
                <ContentState
                    title={t('admin.backups.forbidden')}
                    description={t('admin.backups.forbiddenDescription')}
                />
            ) : state.isLoading ? (
                <ContentState
                    busy
                    title={t('common.loading')}
                    description={t('admin.backups.loading')}
                />
            ) : (
                <>
                    {state.isError ? (
                        <div
                            role="alert"
                            className="rounded-2xl border border-border bg-surface p-5"
                        >
                            <h2 className="font-extrabold text-danger-text">
                                {t('admin.backups.unavailable')}
                            </h2>
                            <p className="mt-2 text-sm text-ink-soft">
                                {t('admin.backups.unavailableDescription')}
                            </p>
                        </div>
                    ) : null}
                    {state.status ? (
                        <>
                            <dl className="grid gap-4 md:grid-cols-3" aria-live="polite">
                                <div className="rounded-2xl border border-border bg-surface p-5 shadow-surface">
                                    <dt className="text-sm font-bold text-muted">
                                        {t('admin.backups.lastSuccess')}
                                    </dt>
                                    <dd className="mt-3 font-extrabold text-ink">
                                        {state.lastSuccess
                                            ? formatBackupDate(state.lastSuccess.finishedAt, locale)
                                            : t('admin.backups.none')}
                                    </dd>
                                </div>
                                <div className="rounded-2xl border border-border bg-surface p-5 shadow-surface">
                                    <dt className="text-sm font-bold text-muted">
                                        {t('admin.backups.active')}
                                    </dt>
                                    <dd className="mt-3 font-extrabold text-ink">
                                        {state.active ? (
                                            <BackupStateBadge state={state.active.state} />
                                        ) : (
                                            t('admin.backups.activeNone')
                                        )}
                                    </dd>
                                </div>
                                <div className="rounded-2xl border border-border bg-surface p-5 shadow-surface">
                                    <dt className="text-sm font-bold text-muted">
                                        {t('admin.backups.nextRun')}
                                    </dt>
                                    <dd className="mt-3 font-extrabold text-ink">
                                        {state.status.configuration.enabled
                                            ? formatBackupDate(
                                                  state.status.configuration.nextRunAt,
                                                  locale,
                                              )
                                            : t('admin.backups.disabled')}
                                    </dd>
                                </div>
                            </dl>
                            {state.canManage ? (
                                <BackupSchedule
                                    key={state.status.storeId}
                                    configuration={state.status.configuration}
                                    storeId={state.status.storeId}
                                    locked={state.locked}
                                    onSave={handler.handleSave}
                                />
                            ) : (
                                <p className="text-sm text-ink-soft">
                                    {t('admin.backups.viewOnly')}
                                </p>
                            )}
                            {state.canManage && state.status.offHost ? (
                                <OffHostBackup
                                    key={state.status.storeId + '-off-host'}
                                    configuration={state.status.offHost}
                                    locked={state.locked}
                                    onSave={handler.handleSaveOffHost}
                                />
                            ) : null}
                            <BackupHistory
                                jobs={state.jobs}
                                canDownload={state.canManage && !state.locked}
                                canManage={state.canManage}
                                locked={state.locked || !!state.active}
                                onRestore={handler.handleRestore}
                                onDelete={handler.handleDelete}
                            />
                            <details className="rounded-2xl border border-border bg-surface p-6 shadow-surface">
                                <summary className="cursor-pointer font-extrabold text-ink">
                                    {t('admin.backups.recovery.title')}
                                </summary>
                                <div className="mt-4 grid gap-4 text-sm leading-relaxed text-ink-soft">
                                    <p>{t('admin.backups.recovery.secret')}</p>
                                    <p>{t('admin.backups.recovery.offHost')}</p>
                                    <ol className="grid list-decimal gap-3 pl-5">
                                        <li>{t('admin.backups.recovery.extract')}</li>
                                        <li>{t('admin.backups.recovery.restore')}</li>
                                    </ol>
                                </div>
                            </details>
                        </>
                    ) : null}
                </>
            )}
            <ConfirmDialog
                open={state.confirmOpen && !state.forbidden}
                title={t('admin.backups.confirmTitle')}
                description={t('admin.backups.impact')}
                confirmLabel={t('admin.backups.confirmStart')}
                isPending={state.pending}
                onConfirm={handler.handleConfirmStart}
                onOpenChange={handler.handleConfirmOpenChange}
            />
        </div>
    )
}
