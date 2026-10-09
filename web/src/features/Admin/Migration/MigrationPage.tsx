import ImportItemDetails from '@/features/Admin/NpmImport/Components/ImportItemDetails/index.tsx'
import type { MigrationSource } from './Types/migration.types.ts'
import { FileInput } from '@rentnerkev/inputs'
import { CustomSelect } from '@rentnerkev/select/select'
import { CustomTooltip } from '@rentnerkev/tooltips/tooltip'

import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import PageHeader from '@/shared/Management/PageHeader.tsx'
import { useMigrationLogic } from './Hooks/useMigrationLogic.ts'

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
                            className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none border-border-strong bg-surface-raised text-ink-soft enabled:hover:border-accent-border enabled:hover:text-accent-ring"
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
                        className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none bg-accent text-accent-foreground enabled:hover:bg-accent-hover"
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
                <section
                    className="min-w-0 rounded-2xl border border-border bg-surface p-[clamp(1.15rem,4vw,1.75rem)] shadow-surface"
                    aria-labelledby="npm-preview-title"
                >
                    <h2 id="npm-preview-title" className="text-lg font-extrabold text-ink">
                        {t('admin.npmImport.previewTitle')}
                    </h2>
                    <p className="mt-2 text-sm text-ink-soft">{t('admin.migration.previewHelp')}</p>
                    <div className="mt-4 flex flex-wrap gap-2" aria-live="polite">
                        {Object.entries(state.preview.counts).map(([status, count]) => (
                            <span
                                key={status}
                                className="inline-flex items-center rounded-full border border-success-text/20 bg-success-bg px-[0.6rem] py-[0.28rem] font-mono text-[0.65rem] font-bold text-success-text"
                            >
                                {count} {t(`admin.npmImport.status.${status}`)}
                            </span>
                        ))}
                    </div>
                    <details className="mt-5" open>
                        <summary className="cursor-pointer font-bold text-ink">
                            {t('admin.npmImport.details')}
                        </summary>
                        <ul className="mt-2 max-h-[32rem] overflow-y-auto">
                            {state.preview.items.map((item) => (
                                <ImportItemDetails
                                    key={`${item.kind}:${item.sourceId}`}
                                    item={item}
                                />
                            ))}
                        </ul>
                    </details>
                    <div className="mt-5 flex flex-wrap gap-3">
                        <button
                            type="button"
                            className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none bg-accent text-accent-foreground enabled:hover:bg-accent-hover"
                            disabled={
                                state.busy !== null ||
                                state.preview.counts.ready + state.preview.counts.partial === 0
                            }
                            onClick={() => void handler.applySource()}
                        >
                            {state.busy === 'apply'
                                ? t('common.working')
                                : t('admin.npmImport.apply')}
                        </button>
                        <button
                            type="button"
                            className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none border-border-strong bg-surface-raised text-ink-soft enabled:hover:border-accent-border enabled:hover:text-accent-ring"
                            disabled={state.busy !== null}
                            onClick={handler.discardPreview}
                        >
                            {t('common.cancel')}
                        </button>
                    </div>
                </section>
            ) : null}
            {state.result ? (
                <section
                    className="min-w-0 rounded-2xl border border-border bg-surface p-[clamp(1.15rem,4vw,1.75rem)] shadow-surface"
                    aria-live="polite"
                >
                    <h2 className="text-lg font-extrabold text-ink">
                        {t('admin.npmImport.resultTitle')}
                    </h2>
                    <p className="mt-2 text-sm text-ink-soft">
                        {t(`admin.migration.source.${state.source}`)}:{' '}
                        {t('admin.npmImport.resultSummary', {
                            imported: state.result.imported,
                            skipped: state.result.skipped,
                            failed: state.result.failed,
                            runtime: t(`admin.npmImport.runtime.${state.result.runtimeStatus}`),
                        })}
                    </p>
                    <details className="mt-4">
                        <summary className="cursor-pointer font-bold text-ink">
                            {t('admin.npmImport.details')}
                        </summary>
                        <ul className="mt-2">
                            {state.result.items.map((item) => (
                                <ImportItemDetails
                                    key={`${item.kind}:${item.sourceId}`}
                                    item={item}
                                />
                            ))}
                        </ul>
                    </details>
                </section>
            ) : null}
            {state.history.length > 0 ? (
                <section className="min-w-0 rounded-2xl border border-border bg-surface p-[clamp(1.15rem,4vw,1.75rem)] shadow-surface">
                    <h2 className="text-lg font-extrabold text-ink">
                        {t('admin.npmImport.history')}
                    </h2>
                    <ul className="mt-3 grid gap-2 text-sm text-ink-soft">
                        {state.history.map((entry) => (
                            <li key={entry.runId}>
                                <details>
                                    <summary className="cursor-pointer">
                                        {entry.sourceSchema.startsWith('npm')
                                            ? t('admin.migration.source.npm')
                                            : entry.sourceSchema.startsWith('zoraxy')
                                              ? t('admin.migration.source.zoraxy')
                                              : entry.sourceSchema.startsWith('rentnerproxy')
                                                ? t('admin.migration.source.rentnerproxy')
                                                : entry.sourceSchema}{' '}
                                        · {entry.imported} {t('admin.npmImport.imported')},{' '}
                                        {entry.skipped} {t('admin.npmImport.skipped')},{' '}
                                        {entry.failed} {t('admin.npmImport.failed')}
                                        {' · '}
                                        {t(`admin.npmImport.runtime.${entry.runtimeStatus}`)}
                                    </summary>
                                    <ul className="mt-2 pl-4">
                                        {entry.items.map((item) => (
                                            <ImportItemDetails
                                                key={`${item.kind}:${item.sourceId}`}
                                                item={item}
                                            />
                                        ))}
                                    </ul>
                                </details>
                            </li>
                        ))}
                    </ul>
                </section>
            ) : null}
        </div>
    )
}
