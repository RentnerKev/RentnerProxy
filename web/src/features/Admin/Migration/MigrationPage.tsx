import ImportPreviewPanel from '@/shared/Imports/Components/ImportPreviewPanel.tsx'
import ImportResultPanel from '@/shared/Imports/Components/ImportResultPanel.tsx'
import ImportHistoryPanel from '@/shared/Imports/Components/ImportHistoryPanel.tsx'
import type { MigrationSource } from './Types/migration.types.ts'
import { FileInput } from '@rentnerkev/inputs'
import { CustomSelect } from '@rentnerkev/select/select'
import { CustomTooltip } from '@rentnerkev/tooltips/tooltip'

import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import PageHeader from '@/shared/Management/PageHeader.tsx'
import { useMigrationLogic } from './Hooks/useMigrationLogic.ts'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'

export default function MigrationPage() {
    const { t } = useTranslationStore()
    const { state, handler } = useMigrationLogic()

    return (
        <div className="grid gap-5">
            <PageHeader
                eyebrow={t('admin.migration.eyebrow')}
                title={t('admin.migration.title')}
                description={t('admin.migration.description')}
            />
            <section
                className="min-w-0 rounded-2xl border border-border bg-surface p-[clamp(1.15rem,4vw,1.75rem)] shadow-surface"
                aria-labelledby="migration-export-title"
            >
                <h2 id="migration-export-title" className="text-lg font-extrabold text-ink">
                    {t('admin.migration.exportTitle')}
                </h2>
                <p className="mt-2 text-sm text-ink-soft">{t('admin.migration.exportHelp')}</p>
                <div className="mt-5">
                    <CustomTooltip collisionPadding={10} content={t('admin.migration.exportHelp')}>
                        <button
                            type="button"
                            className={buttonClassName('secondary')}
                            disabled={state.exporting}
                            onClick={() => void handler.downloadExport()}
                        >
                            {state.exporting
                                ? t('common.working')
                                : t('admin.migration.exportButton')}
                        </button>
                    </CustomTooltip>
                </div>
                {state.error === 'export_failed' ? (
                    <p role="alert" className="mt-4 text-sm text-danger-text">
                        {t('admin.migration.errors.export_failed')}
                    </p>
                ) : null}
            </section>
            <section
                className="min-w-0 rounded-2xl border border-border bg-surface p-[clamp(1.15rem,4vw,1.75rem)] shadow-surface"
                aria-labelledby="migration-source-title"
            >
                <h2 id="migration-source-title" className="text-lg font-extrabold text-ink">
                    {t('admin.migration.importTitle')}
                </h2>
                <div className="mt-5 grid gap-2">
                    <label
                        className="text-[0.82rem] font-[750] text-ink-soft"
                        htmlFor="migration-source"
                    >
                        {t('admin.migration.sourceLabel')}
                    </label>
                    <CustomSelect<MigrationSource>
                        id="migration-source"
                        aria-label={t('admin.migration.sourceLabel')}
                        aria-describedby="migration-source-help"
                        value={state.source}
                        disabled={state.busy !== null}
                        onValueChange={handler.selectSource}
                        options={[
                            {
                                value: 'rentnerproxy',
                                label: t('admin.migration.source.rentnerproxy'),
                            },
                            { value: 'npm', label: t('admin.migration.source.npm') },
                            { value: 'zoraxy', label: t('admin.migration.source.zoraxy') },
                        ]}
                    />
                </div>
                <p id="migration-source-help" className="mt-3 text-sm text-ink-soft">
                    {t(`admin.migration.sourceHelp.${state.source}`)}
                </p>
                <div className="mt-5 grid gap-2">
                    <label
                        className="text-[0.82rem] font-[750] text-ink-soft"
                        htmlFor="migration-file"
                    >
                        {t('admin.migration.fileLabel')}
                    </label>
                    <FileInput
                        key={state.source}
                        id="migration-file"
                        aria-describedby="migration-source-help"
                        type="file"
                        accept={
                            state.source === 'npm'
                                ? '.sqlite,.db,application/vnd.sqlite3'
                                : state.source === 'zoraxy'
                                  ? '.zip,application/zip'
                                  : '.json,application/json'
                        }
                        disabled={state.busy !== null}
                        onChange={(event) => {
                            handler.selectFile(event.currentTarget.files?.[0] ?? null)
                        }}
                    />
                </div>
                <div className="mt-5 flex flex-wrap gap-3">
                    <button
                        type="button"
                        className={buttonClassName('primary')}
                        disabled={!state.file || state.busy !== null}
                        onClick={() => void handler.previewSource()}
                    >
                        {state.busy === 'preview'
                            ? t('common.working')
                            : t('admin.npmImport.preview')}
                    </button>
                </div>
                {state.error && state.error !== 'export_failed' ? (
                    <p role="alert" className="mt-4 text-sm text-danger-text">
                        {t(`admin.migration.errors.${state.error}`)}
                    </p>
                ) : null}
            </section>
            {state.preview ? (
                <ImportPreviewPanel
                    preview={state.preview}
                    busy={state.busy}
                    help={t('admin.migration.previewHelp')}
                    onApply={handler.applySource}
                    onDiscard={handler.discardPreview}
                />
            ) : null}
            {state.result ? (
                <ImportResultPanel
                    result={state.result}
                    sourceLabel={t(`admin.migration.source.${state.source}`)}
                />
            ) : null}
            {state.history.length > 0 ? (
                <ImportHistoryPanel history={state.history} showSource />
            ) : null}
        </div>
    )
}
