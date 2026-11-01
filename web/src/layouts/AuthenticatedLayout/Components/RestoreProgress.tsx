import type { ManagedBackupMaintenance } from '@/lib/Backups/Types/backups.types.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'

export default function RestoreProgress({
    maintenance,
    disconnected,
    onDismiss,
}: {
    readonly maintenance: ManagedBackupMaintenance
    readonly disconnected: boolean
    readonly onDismiss?: (() => void) | undefined
}) {
    const { t } = useTranslationStore()
    const failed = maintenance.state === 'failed' || maintenance.state === 'interrupted'
    return (
        <main
            className="fixed inset-0 z-100 grid min-h-screen place-content-center gap-5 overflow-auto bg-page p-8 text-ink"
            aria-labelledby="restore-progress-title"
        >
            <div className="mx-auto grid w-full max-w-xl gap-5 rounded-2xl border border-border bg-surface p-8 shadow-surface">
                <h1 id="restore-progress-title" className="text-3xl font-extrabold">
                    {t('admin.backups.restoreScreen.title')}
                </h1>
                <p className="text-ink-soft">
                    {t('admin.backups.restoreScreen.description', {
                        backup: maintenance.artifactId,
                        user:
                            maintenance.actorName ?? t('admin.backups.restoreScreen.actorUnknown'),
                    })}
                </p>
                <label htmlFor="restore-progress" className="font-extrabold">
                    {t('admin.backups.restoreScreen.progress', {
                        percent: maintenance.progressPercent,
                    })}
                </label>
                <progress
                    id="restore-progress"
                    max={100}
                    value={maintenance.progressPercent}
                    className="h-4 w-full accent-accent"
                />
                <output className="text-sm text-ink-soft">
                    {t(`admin.backups.restoreScreen.phases.${maintenance.phase}`)}
                </output>
                {failed ? (
                    <p role="alert" className="text-danger-text">
                        {t('admin.backups.restoreScreen.failed')}
                    </p>
                ) : null}
                {maintenance.state === 'succeeded' ? (
                    <p>{t('admin.backups.restoreScreen.complete')}</p>
                ) : null}
                {disconnected ? (
                    <p role="alert" className="text-warning-text">
                        {t('admin.backups.restoreScreen.connectionLost')}
                    </p>
                ) : null}
                {onDismiss ? (
                    <button
                        type="button"
                        className={buttonClassName('secondary')}
                        onClick={onDismiss}
                    >
                        {t('admin.backups.restoreScreen.returnToPage')}
                    </button>
                ) : null}
            </div>
        </main>
    )
}
