import { CheckboxInput, NumberInput } from '@rentnerkev/inputs'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useBackupScheduleLogic from '../Hooks/useBackupScheduleLogic.ts'
import type { BackupScheduleProps } from '../Types/backups-ui.types.ts'

export default function BackupSchedule(props: BackupScheduleProps) {
    const { t, locale } = useTranslationStore()
    const { state, handler } = useBackupScheduleLogic(props)
    return (
        <section
            className="min-w-0 rounded-2xl border border-border bg-surface p-6 shadow-surface"
            aria-labelledby={state.id + '-title'}
        >
            <h2 id={state.id + '-title'} className="text-lg font-extrabold text-ink">
                {t('admin.backups.schedule.title')}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                {t('admin.backups.schedule.description')}
            </p>
            <form onSubmit={handler.handleSubmit} className="mt-5 grid gap-5" noValidate>
                <label
                    htmlFor={state.id + '-enabled'}
                    className="flex items-center gap-3 text-sm font-bold text-ink"
                >
                    <CheckboxInput
                        id={state.id + '-enabled'}
                        name="enabled"
                        checked={state.enabled}
                        disabled={state.locked}
                        onChange={(event) => handler.handleEnabledChange(event.target.checked)}
                    />
                    {t('admin.backups.schedule.enabled')}
                </label>
                <div className="grid gap-5 sm:grid-cols-2">
                    <NumberInput
                        id={state.id + '-interval'}
                        name="intervalHours"
                        label={t('admin.backups.schedule.interval')}
                        description={t('admin.backups.schedule.intervalHelp')}
                        locale={locale}
                        value={state.intervalHours}
                        onValueChange={handler.handleIntervalChange}
                        disabled={state.locked}
                        minValue={1}
                        maxValue={8760}
                        validationMode="external"
                        required
                    />
                    <NumberInput
                        id={state.id + '-retention'}
                        name="retentionCount"
                        label={t('admin.backups.schedule.retention')}
                        description={t('admin.backups.schedule.retentionHelp')}
                        locale={locale}
                        value={state.retentionCount}
                        onValueChange={handler.handleRetentionChange}
                        disabled={state.locked}
                        minValue={1}
                        maxValue={50}
                        validationMode="external"
                        required
                    />
                </div>
                {state.conflict ? (
                    <p role="alert" className="text-sm text-warning-text">
                        {t('admin.backups.schedule.conflict')}
                    </p>
                ) : null}
                {!state.valid ? (
                    <p role="alert" className="text-sm text-danger-text">
                        {t('admin.backups.errors.invalid_input')}
                    </p>
                ) : null}
                <div className="flex flex-wrap gap-3">
                    <button
                        type="submit"
                        className={buttonClassName('primary')}
                        disabled={!state.canSave}
                    >
                        {state.pending ? t('common.working') : t('admin.backups.schedule.save')}
                    </button>
                    <button
                        type="button"
                        className={buttonClassName('secondary')}
                        disabled={state.locked}
                        onClick={handler.handleReset}
                    >
                        {t('admin.backups.schedule.reset')}
                    </button>
                </div>
            </form>
        </section>
    )
}
